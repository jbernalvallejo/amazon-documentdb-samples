import { Construct } from 'constructs';

import { aws_iam as iam, aws_lambda as lambda, aws_sns as sns,
         aws_stepfunctions as sf, aws_stepfunctions_tasks as tasks } from 'aws-cdk-lib';

interface RemediationProps {
  clusterParameterGroup: string;
  clusterBackupRetentionPeriod: number;
}

export class RemediationStateMachineTarget extends Construct {

  public readonly stateMachine: sf.StateMachine;

  constructor(scope: Construct, id: string, props: RemediationProps) {
    super(scope, id);

    // sns topic for notifications
    const topic = new sns.Topic(this, 'ComplianceNotificationsTopic', {
      displayName: 'Compliance Notifications'
    });

    // parameter group remediation
    // (the IAM role below can be shared among lambda functions that remediate
    // wrong parameter group, backup retention period and deletion protection disabled 
    // as they both perform the same operations and thus require same IAM permissions 
    // with current implementation)
    const remediationRole = new iam.Role(this, 'ParameterGroupRemediationRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    }); 
    remediationRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    remediationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'rds:DescribeDBClusters',
        'rds:ModifyDBCluster'
      ],
      resources: ['*']
    }));

    const parameterGroupRemediationFn = new lambda.Function(this, 'ParameterGroupRemediationFn', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lib/functions/cluster-parameter-group-remediation'),
      role: remediationRole,
      environment: {
        DESIRED_CLUSTER_PARAMETER_GROUP: props.clusterParameterGroup
      },
      tracing: lambda.Tracing.ACTIVE
    });
    const parameterGroupRemediationLiveAlias = parameterGroupRemediationFn.addAlias('live');

    // cluster backup retention period
    const backupRetentionRemediationFn = new lambda.Function(this, 'BackupRetentionRemediationFn', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lib/functions/cluster-backup-retention-remediation'),
      role: remediationRole,
      environment: {
        DESIRED_CLUSTER_BACKUP_RETENTION_PERIOD: props.clusterBackupRetentionPeriod.toString()
      },
      tracing: lambda.Tracing.ACTIVE
    });
    const backupRetentionRemediationLiveAlias = backupRetentionRemediationFn.addAlias('live');

    // cluster deletion protection remediation
    const deletionProtectionRemediationFn = new lambda.Function(this, 'DeletionProtectionRemediationFn', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lib/functions/cluster-deletion-protection-remediation'),
      role: remediationRole,
      tracing: lambda.Tracing.ACTIVE
    });
    const deletionProtectionRemediationLiveAlias = deletionProtectionRemediationFn.addAlias('live');

    // state machine definition
    const notifyNonComplianceState = new tasks.SnsPublish(this, 'Notify non-compliance resource', { 
      topic,
      subject: "A non-compliant event has occurred",
      inputPath: "$.detail",
      message: sf.TaskInput.fromJsonPathAt("$"),
      resultPath: sf.JsonPath.DISCARD,
      outputPath: "$.detail"
    });

    const resourceNotFoundErrorFallback = new sf.Pass(this, 'Resource not found error', {
      result: sf.Result.fromObject({message: "The non-compliance resource was not found"})
    });

    const parameterGroupRemediationState = new tasks.LambdaInvoke(this, 'Parameter group', {
      lambdaFunction: parameterGroupRemediationLiveAlias,
      payload: sf.TaskInput.fromObject({
        resourceId: sf.JsonPath.stringAt("$.resourceId")
      }),
      resultPath: sf.JsonPath.DISCARD
    });
    parameterGroupRemediationState.addCatch(resourceNotFoundErrorFallback, {
      errors: ["ResourceNotFoundError"]
    });

    const backupRetentionRemediationState = new tasks.LambdaInvoke(this, 'Backup retention', {
      lambdaFunction: backupRetentionRemediationLiveAlias,
      payload: sf.TaskInput.fromObject({
        resourceId: sf.JsonPath.stringAt("$.resourceId")
      }),
      resultPath: sf.JsonPath.DISCARD
    });
    backupRetentionRemediationState.addCatch(resourceNotFoundErrorFallback, {
      errors: ["ResourceNotFoundError"]
    });

    const deletionProtectionRemediationState = new tasks.LambdaInvoke(this, 'Deletion protection', {
      lambdaFunction: deletionProtectionRemediationLiveAlias,
      payload: sf.TaskInput.fromObject({
        resourceId: sf.JsonPath.stringAt("$.resourceId")
      }),
      resultPath: sf.JsonPath.DISCARD
    });
    deletionProtectionRemediationState.addCatch(resourceNotFoundErrorFallback, {
      errors: ["ResourceNotFoundError"]
    });

    const choice = new sf.Choice(this, 'Remediation type?', {});
    choice.when(sf.Condition.stringEquals("$.configRuleName", "documentdb-cluster-parameter-group"), parameterGroupRemediationState);
    choice.when(sf.Condition.stringEquals("$.configRuleName", "documentdb-cluster-backup-retention"), backupRetentionRemediationState);
    choice.when(sf.Condition.stringEquals("$.configRuleName", "documentdb-cluster-deletion-protection-enabled"), deletionProtectionRemediationState);
    
    const remediationExecutedState = new sf.Pass(this, 'Remediation executed', {
      result: sf.Result.fromObject({message: "The remediation for the non-compliance resource has been executed"})
    });

    parameterGroupRemediationState.next(remediationExecutedState);
    backupRetentionRemediationState.next(remediationExecutedState);
    deletionProtectionRemediationState.next(remediationExecutedState);

    const remediationTypeNotFoundState = new sf.Pass(this, "Remediation type not found", {
      result: sf.Result.fromObject({ message: "Remediation type not found" })
    });
    choice.otherwise(remediationTypeNotFoundState);

    const notifyRemediationResultState = new tasks.SnsPublish(this, 'Notify remediation result', { 
      topic,
      subject: sf.JsonPath.stringAt("$.message"),
      message: sf.TaskInput.fromJsonPathAt("$.message")
    });

    remediationExecutedState.next(notifyRemediationResultState);
    remediationTypeNotFoundState.next(notifyRemediationResultState);
    resourceNotFoundErrorFallback.next(notifyRemediationResultState);

    const definition = notifyNonComplianceState.next(choice);

    this.stateMachine = new sf.StateMachine(this, 'RemediationStateMachine', {
      definition,
      stateMachineName: "non-compliance-remediation-workflow",
      tracingEnabled: true
    });
  }

}

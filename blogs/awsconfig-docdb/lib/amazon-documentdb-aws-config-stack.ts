// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_iam as iam, aws_config as config, aws_events as events, aws_events_targets as targets,
         aws_lambda as lambda, aws_logs as logs, aws_sqs as sqs } from 'aws-cdk-lib';
import { RemediationStateMachineTarget } from './constructs/remediation-state-machine-target';

interface DocumentDbConfigStackProps extends StackProps {
  clusterParameterGroup?: string;
  backupRetentionPeriod?: number;
}

export class AmazonDocumentdbAwsConfigStack extends Stack {
  constructor(scope: Construct, id: string, props?: DocumentDbConfigStackProps) {
    super(scope, id, props);

    const clusterParameterGroup = props?.clusterParameterGroup || 'blogpost-param-group';
    const clusterBackupRetentionPeriod = props?.backupRetentionPeriod || 7;

    // aws managed rules
    new config.ManagedRule(this, 'ClusterDeletionProtectionEnabled', {
      identifier: config.ManagedRuleIdentifiers.RDS_CLUSTER_DELETION_PROTECTION_ENABLED,
      configRuleName: 'documentdb-cluster-deletion-protection-enabled',
      ruleScope: config.RuleScope.fromResources([config.ResourceType.RDS_DB_CLUSTER])
    });

    new config.ManagedRule(this, 'StorageEncrypted', {
      identifier: config.ManagedRuleIdentifiers.RDS_STORAGE_ENCRYPTED,
      configRuleName: 'documentdb-cluster-storage-encrypted',
      ruleScope: config.RuleScope.fromResources([config.ResourceType.RDS_DB_INSTANCE])
    });

    // custom rules
    // cluster parameter group
    const clusterParameterGroupRole = new iam.Role(this, 'ClusterParameterGroupRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    }); 
    clusterParameterGroupRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    clusterParameterGroupRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSConfigRulesExecutionRole'));

    const clusterParameterGroupFn = new lambda.Function(this, 'ClusterParameterGroupFn', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lib/functions/cluster-parameter-group-rule'),
      role: clusterParameterGroupRole
    });

    new config.CustomRule(this, 'ClusterParameterGroupRule', {
      lambdaFunction: clusterParameterGroupFn,
      configurationChanges: true,
      configRuleName: 'documentdb-cluster-parameter-group',
      description: 'Evaluates whether the cluster parameter group is the one provided to the rule as a parameter',
      ruleScope: config.RuleScope.fromResources([config.ResourceType.RDS_DB_CLUSTER]),
      inputParameters: {
        desiredClusterParameterGroup: clusterParameterGroup
      }
    });

    // cluster backup retention
    const clusterBackupRententionRole = new iam.Role(this, 'ClusterBackupRetentionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    }); 
    clusterBackupRententionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    clusterBackupRententionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSConfigRulesExecutionRole'));

    const clusterBackupRetentionFn = new lambda.Function(this, 'ClusterBackupRetentionFn', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lib/functions/cluster-backup-retention-rule'),
      role: clusterBackupRententionRole
    });

    new config.CustomRule(this, 'ClusterBackupRetentionRule', {
      lambdaFunction: clusterBackupRetentionFn,
      configurationChanges: true,
      configRuleName: 'documentdb-cluster-backup-retention',
      description: 'Evaluates whether the cluster backup retention policy has been set to a greater value than the one provided as parameter',
      ruleScope: config.RuleScope.fromResources([config.ResourceType.RDS_DB_CLUSTER]),
      inputParameters: {
        minBackupRetentionPeriod: clusterBackupRetentionPeriod
      }
    });

    // instances homogeneous
    const instancesHomogeneousRole = new iam.Role(this, 'InstancesHomogeneousRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    }); 
    instancesHomogeneousRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    instancesHomogeneousRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSConfigRulesExecutionRole'));
    instancesHomogeneousRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['rds:DescribeDBInstances'],
      resources: ['*']
    }));

    const instancesHomogeneousFn = new lambda.Function(this, 'InstancesHomogeneousFn', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lib/functions/instances-homogeneous-rule'),
      role: instancesHomogeneousRole
    });

    new config.CustomRule(this, 'InstancesHomogeneousRule', {
      lambdaFunction: instancesHomogeneousFn,
      configurationChanges: true,
      configRuleName: 'documentdb-cluster-instances-homogeneous',
      description: 'Evaluates whether all instances in an Amazon DocumentDB cluster belong to the same instance family and size',
      ruleScope: config.RuleScope.fromResources([config.ResourceType.RDS_DB_INSTANCE])
    });

    // remediation

    // cloudwatch log group for debugging purposes
    const logGroup = new logs.LogGroup(this, 'AuditLogGroup', {
      logGroupName: `/aws/events/documentdb-config-events`,
      retention: logs.RetentionDays.ONE_WEEK
    });

    const stateMachineTarget = new RemediationStateMachineTarget(this, 'RemediationStateMachineTarget', {
      clusterParameterGroup,
      clusterBackupRetentionPeriod
    });

    const rule = new events.Rule(this, 'ComplianceRule', {
      eventPattern: {
        source: ['aws.config'],
        detailType: ['Config Rules Compliance Change'],
        detail: {
          messageType: ['ComplianceChangeNotification'],
          configRuleName: [{prefix: 'documentdb-'}],
          resourceType: ['AWS::RDS::DBCluster', 'AWS::RDS::DBInstance'],
          newEvaluationResult: {
            complianceType: ['NON_COMPLIANT']
          }
        }
      }
    });

    rule.addTarget(new targets.CloudWatchLogGroup(logGroup));
    
    rule.addTarget(new targets.SfnStateMachine(stateMachineTarget.stateMachine, {
      deadLetterQueue: new sqs.Queue(this, 'DLQ'),
      maxEventAge: Duration.seconds(60),
      retryAttempts: 3
    }));
  }
}

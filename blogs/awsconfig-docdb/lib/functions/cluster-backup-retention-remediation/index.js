// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const aws = require('aws-sdk');
const docDb = new aws.DocDB();

exports.handler = async event => {
  try {
    const desiredClusterBackupRetentionPeriod = process.env.DESIRED_CLUSTER_BACKUP_RETENTION_PERIOD;

    if (!desiredClusterBackupRetentionPeriod) {
      throw new Error('Desired cluster backup retention period not found');
    }

    console.log(event);
    const {resourceId} = event;
    const dbClusterIdentifier = await getDbClusterIdentifier(resourceId);
    const params = {
      DBClusterIdentifier: dbClusterIdentifier,
      BackupRetentionPeriod: desiredClusterBackupRetentionPeriod
    };

    await docDb.modifyDBCluster(params).promise();
    return;

  } catch (e) {
    console.log('There has been an error', e);
    throw e;
  }
};

async function getDbClusterIdentifier(resourceId) {
  try {
    const {DBClusters: clusters} = await docDb.describeDBClusters().promise();  
    const {DBClusterIdentifier: dbClusterIdentifier} = clusters.find(c => c.DbClusterResourceId === resourceId);

    if (!dbClusterIdentifier) {
      throw new Error(`Cluster with resourceId=${resourceId} not found`);
    }

    return dbClusterIdentifier;

  } catch (e) {
    console.log(e);
    throw e;
  }
}
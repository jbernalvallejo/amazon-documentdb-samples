// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const aws = require('aws-sdk');
const docDb = new aws.DocDB();

class ResourceNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResourceNotFoundError';
    this.message = message;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ResourceNotFoundError);
    }
  }
}

exports.handler = async event => {
  try {
    const desiredClusterBackupRetentionPeriod = process.env.DESIRED_CLUSTER_BACKUP_RETENTION_PERIOD;

    if (!desiredClusterBackupRetentionPeriod) {
      throw new Error('Desired cluster backup retention period not found');
    }

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
    const cluster = clusters.find(c => c.DbClusterResourceId === resourceId);

    if (!cluster) {
      throw new ResourceNotFoundError(`Cluster with resourceId=${resourceId} not found`);
    }

    return cluster.DBClusterIdentifier;

  } catch (e) {
    console.log(e);
    throw e;
  }
}
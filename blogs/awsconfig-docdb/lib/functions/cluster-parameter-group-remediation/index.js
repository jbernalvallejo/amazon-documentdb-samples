// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const aws = require('aws-sdk');
const docDb = new aws.DocDB();

class ResourceNotFoundError extends Error{
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
    const desiredClusterParameterGroup = process.env.DESIRED_CLUSTER_PARAMETER_GROUP;

    if (!desiredClusterParameterGroup) {
      throw new Error('Desired cluster parameter group not found');
    }

    const {resourceId} = event;
    const dbClusterIdentifier = await getDbClusterIdentifier(resourceId);
    const params = {
      DBClusterIdentifier: dbClusterIdentifier,
      DBClusterParameterGroupName: desiredClusterParameterGroup
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
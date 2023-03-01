#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { AmazonDocumentdbAwsConfigStack } from '../lib/amazon-documentdb-aws-config-stack';

const app = new App();
new AmazonDocumentdbAwsConfigStack(app, 'AmazonDocumentDbAwsConfigStack');

# Rule: Keep Code and Architecture Diagram in Sync

This document outlines the mandatory procedure for generating or updating application code and infrastructure based on an architecture diagram.

## Workflow

When a request is made to generate or update an application, the following steps must be executed:

1. **Locate the Source of Truth:**

   * You must first search the project for an architecture diagram file.

   * The valid file formats are `.drawio` or `.drawio.xml`. This diagram is the definitive source of truth for the application's structure.

2. **Analyze Existing Code:**

   * If the target directory already contains code, your primary task is **synchronization**.

   * You must perform a detailed analysis of both the diagram and the existing code to identify any discrepancies.

   * Your goal is to generate only the necessary changes to align the code and infrastructure with the diagram.

3. **Adhere to the Technology Stack:**

   * **Infrastructure as Code:** All cloud infrastructure must be defined using **Python CDK v2**.

   * **Lambda Function Runtime:** All AWS Lambda functions must be written using **Python 3.9**.

# Implementation Plan

You are acting as an experienced software engineer. Your task is to create a detailed, step-by-step implementation plan. To complete the task you must

- read ALL files in the .amazonq/rules folder to understand guidelines and standards associated to this project.
- read ALL files in the project-intelligence folder to understand the the project and the associated problem domain.
- read the feature specification.
- define a solid implementation plan.
- break it down into small, iterative chunks that build on each other.
- review the results and make sure that the steps are small enough to be implemented safely with strong testing, but big enough to move the project forward.
- iterate until you think that the steps are right-sized for this project.

Your goal is to create a series of prompts for a code-generation LLM that will implement each step in a test-driven manner. The prompts should be structured using the RISEN framework. Use the following prompt template for each prompt:

You are acting as [insert the role you want AI to take]. Your task is to [insert the main task you want AI to complete]. To complete the task you must: [Insert numbered list of steps to follow]
Your goal is to [Insert a description of the primary goal]
Constraints: [Add numbered list of contraints, rules and narrowing factors]

Save the implementation plan as `prompt_plan.md` next to the feature specification file.

For each prompt ensure, that it contains a step to read all files in the .amazonq/rules folder to understand the guidelines and standards.
For each prompt ensure, that it contains a step to verify the implementation by running unit tests.
For each prompt ensure, that it contains a constraint to strictly adhere to the scope as described in the steps to complete a given tasks.
Make sure that each prompt builds on the previous prompts.
Format each prompt as plaintext codeblock.
Use markdown.

## How to Use

1. Open a new chat inside your IDE
2. Add the path to your specification file to the context, e.g. `/docs/myspec.md`
3. Add the path to your docs folder to the context, e.g. `/docs/*`
4. Copy-pase the prompt into your chat and run it

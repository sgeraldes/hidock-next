# Extraction prompt+model evaluation — arm A vs arm C

Comparison of meeting decision/action extraction across all 18 transcribed recordings.

- **Arm A (current, production baseline):** current `buildPrompt` + `llama3.2` (3B)
- **Arm C (proposed):** grounded rules-not-exemplars prompt + `gemma3:12b`

Arm B (improved prompt + llama3.2) was tested and REJECTED — it leaked its own few-shot
example sentences into 6/8 outputs and hallucinated (e.g. inventing 'NICE guidelines for
breast cancer treatment' on the Health Concerns meeting). Arm C uses rules instead of
verbatim exemplars (fixes the bleed) plus an explicit anti-hallucination grounding rule.

## Aggregate

| | decisions | actions |
|---|---|---|
| Arm A (llama3.2) | 41 | 45 |  _(excludes Sprint Planning: llama3.2 fetch-failed x5 on that 29k transcript)_
| Arm C (gemma3:12b) | 78 | 99 |

Example-bleed in arm C: 0/18. Hallucination markers (NICE/breast cancer/NHS/private healthcare) in arm C: 0/18.

## Per-meeting output

### File Transfer, Logging, & MTLS Testing Block  
_(11908 chars, recording 5abf6a09-9060-40bc-bba1-9297290dc965)_

**Arm A (current + llama3.2):**
- decisions:
  - We shouldn't change anything for secure logging.
- actions:
  - Verify changes on pre-broad  _(@Nick)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The UV ID will be removed.
  - Secure logging should stay as is.
  - Files should be kept as they are received unless information on how they should look is received.
- actions:
  - Nick will raise a new ticket and put the actual expectation.  _(@Nick)_
  - Rajiv will let Nick know if testing will take longer.  _(@Rajiv)_
  - Nick will chase the new backend name.  _(@Nick)_
  - Rajiv will verify changes pushed into pre-broad.  _(@Rajiv)_
  - Someone will check with the team that did the API.dev with Ricardo and see how they've done it and gone through their testing.
  - Nicolette will share the board.  _(@Nicolette)_
  - Everyone should put their votes in for who they think should lead each epic.

### IP5 Metadata and Authentication Fixes  
_(4432 chars, recording 69cd0c7c-dfa7-497f-b1d0-ad0339019c09)_

**Arm A (current + llama3.2):**
- decisions:
  - Use error code 12 for validation metadata
- actions:
  - Prioritize ticket for multi-part file transfer  _(@Kelly)_
  - Sync with Nick on metadata validation  _(@Glenn)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team agreed that error code 12 can be used for validation metadata.
- actions:
  - Glenn will let Nicolette know the outcome of planning.  _(@Glenn)_
  - Nick will get the ticket from Nicoletta.  _(@Nick)_
  - Kelly will send Nick the details of the ticket.  _(@Kelly)_

### 2026Aug20-094614-Rec00.hda  
_(11021 chars, recording 50953c54-b22e-4bc3-b097-1f11413495e7)_

**Arm A (current + llama3.2):**
- decisions:
  - Store data for 30 days
- actions:
  - Implement changes  _(@Sianka)_
  - Review and approve  _(@Zacharias)_
  - Remove VCSM toggles  _(@Dave)_
  - Schedule call for retention time  _(@Dave)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team decided to set the retention time for observability data to 30 days.
- actions:
  - Dave needs to focus on the two SIMS components in sprint.  _(@Dave)_
  - Harsha will send observability tickets to Mariana and Kelly.  _(@Harsha)_
  - Dave will send the bug ticket to the devs chat.  _(@Dave)_
  - Dave needs to get eyes on the SRV tickets added to the EV2 Network Signal Dictionary.  _(@Dave)_
  - Dave will contact Kelly to confirm the details on the SIMS ticket.  _(@Dave)_
  - Zacharias will pick up another ticket.  _(@Zacharias)_
  - Sianka will continue working on the other ticket.  _(@Sianka)_
  - Brian will resolve merge conflicts for SGM.  _(@Brian)_
  - Brian will look into the support ticket from yesterday.  _(@Brian)_
  - Derek will loop in Fulvio regarding versioning.  _(@Derek)_
  - Derek will make Mark and Dan Morris aware of the cost analysis.  _(@Derek)_

### Halo Daily Standup and Epic Planning  
_(12366 chars, recording acceaa45-6aea-43d6-adc3-93b19a365bd9)_

**Arm A (current + llama3.2):**
- decisions:
  - _(none)_
- actions:
  - _(none)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team will do a refinement of the DP active DP Epic this afternoon.
  - If Gautham is back from his holidays, the mentoring twelve Vins ticket can be closed down.
  - The team will stick with their plan for the three Epics.
- actions:
  - Steve will ask Gautham about closing the mentoring twelve Vins ticket.  _(@Steve)_
  - Steve will try to get the Chinese version pipeline working again.  _(@Steve)_
  - Seneeka will look into the DPQE KeyCo combination information support ticket.  _(@Seneeka)_
  - Parth will commit the VCI component tests.  _(@Parth)_
  - Brian will message Chandra again.  _(@Brian)_
  - Dave will go through the DP active DP Epic.  _(@Dave)_

### UCC Component Alignment and Architecture Strategy  
_(7602 chars, recording 744769fb-e1af-48d9-ab47-3f42a6de956b)_

**Arm A (current + llama3.2):**
- decisions:
  - We will continue to work on option one, which is the current proposed solution or architecture.
- actions:
  - Re-touch base with Anton, Vinissa, and Kelly.  _(@Speaker 1)_
  - Check in the raw data if it arrived.  _(@Speaker 2)_
  - Pursue to see the file transfer capability.  _(@Speaker 1)_
  - Pick up the UCC component work after prioritizing FIZO and L481.  _(@Speaker 4)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team will continue to work with the architecture provided by Stefan as an immediate solution.
  - The team will focus on option one, which is the current proposed solution using the UCC component.
  - The team will not be discussing option two as part of this forum for immediate deliverables.
  - Engineering data will be in the production environment of data tracking.
- actions:
  - Speaker 1 will re-touch base with Anton, Vinissa, and Kelly.  _(@Speaker 1)_
  - Vinissa will pick up the work after concluding priorities for FIZO, L481.  _(@Vinissa)_
  - Annie or someone on the team will communicate if changes occur to the effort.  _(@Annie)_
  - Speaker 2 will communicate against the VCDP interface.  _(@Speaker 2)_
  - Speaker 2 will show Shannan when the data is directly forwarded to prod.  _(@Speaker 2)_

### Health Concerns, Kiro Integration, and Project Challenges  
_(27091 chars, recording d71e3d19-43a5-4d16-a391-90be80a77588)_

**Arm A (current + llama3.2):**
- decisions:
  - Use Kiro for planning
  - Share Confluence link
  - Add people to Kero project
- actions:
  - Send Confluence link to Shelley  _(@Shelley)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team will use Kiro to do the planning.
  - The team will feed back to Mark about the Kiro usage.
  - The team will try to cover as much work as possible using Kiro.
  - The team will validate the priorities given by Kiro.
- actions:
  - Kelly will send a link to the Confluence page containing the Kiro logic.  _(@Kelly)_
  - Chetan will put the Kiro project in a shared folder.  _(@Chetan)_
  - Nikki will set up people in the Kiro project.  _(@Nikki)_
  - Kelly will have a word with Chetan to see if there’s somewhere he can put it to share.  _(@Kelly)_
  - Kelly will send the process by which to attach Kiro to Confluence.  _(@Kelly)_

### 2026Aug27-130045-Rec17.hda  
_(491 chars, recording b4427af1-6485-4229-8b89-cdb2ca7bbf84)_

**Arm A (current + llama3.2):**
- decisions:
  - _(none)_
- actions:
  - _(none)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The group decided to drop off and return if Dave starts a call
- actions:
  - _(none)_

### [Halo] Refinement  
_(67160 chars, recording 6faba625-ce97-4cd1-ab97-bf38aa7bfe7d)_

**Arm A (current + llama3.2):**
- decisions:
  - Remove redundant events
  - Simplify data product delivery
  - Use VUID instead of VIN
  - Implement source-based routing
  - Use Redis for deduping
- actions:
  - Share epic with team  _(@Dave)_
  - Review and update tickets  _(@Dave)_
  - Review and update tickets  _(@Steve)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The global hash set will be maintained by DPM.
  - The TTL for the Ddupe cache in production will be seven days.
  - The TTL for the Ddupe cache in pre-production will be one hour.
  - DCSE will bypass the DV call.
  - The global hash set is the single value that captures if anything has changed in the DP set.
  - The design replaces all that with a simple reactive model.
  - The inbound manifest tells us what’s active, not our transition from pending to active.
  - The pending configs is what the outbound configs are.
  - The design removes policies.
  - The inbound manifest controls are stored as pending.
  - The source-based routing will be used rather than simple processing paths.
  - The TTL approach is the correct sign.
- actions:
  - Dave will share the document and the epic.  _(@Dave)_
  - Dave will fix the little things in this document.  _(@Dave)_
  - Soneika will lead the reactive data collector enablement and provisioning design.  _(@Soneika)_
  - Zakir will try to do one of these designs without AI.  _(@Zakir)_
  - Dave will reach out to Soneika and others when he has time to start looking into this again.  _(@Dave)_

### [Halo] Sprint Planning  
_(29394 chars, recording 48958ad0-0a09-43db-b1f1-f3ae174cde5a)_

**Arm A (current + llama3.2):**
- _MODEL FAILURE: llama3.2 fetch-failed x5 on this 29k transcript_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team decided to move story point 9022 to the next sprint.
  - The team decided to drop the story points for ticket 8889 down to one and a half or two.
  - The team decided to call the story points for ticket 8889 one.
  - The team decided to drop the story points for ticket 8895 down to two.
  - The team decided to move ticket 8893 to done.
  - The team decided to drop the story points for ticket 8893 down to two.
  - The team decided to leave the story points for ticket 9529 as one.
  - The team decided to move ticket 9529 to done.
  - The team decided to move ticket 9529 to one.
  - The team decided to leave the story points for ticket Grace's ticket as three.
  - The team decided to drop the story points for Grace's ticket to one.
  - The team decided to move ticket 9529 to done.
  - The team decided to move ticket 9529 to one.
  - The team decided to move ticket 9529 to done.
  - The team decided to drop the story points for ticket 9529 to zero.
  - The team decided to move ticket 9529 to done.
  - The team decided to cancel the data dog logging ticket.
  - The team decided to put the VLC S3 writer project in a subgroup on the backlog.
- actions:
  - Dave will whack a couple of tickets over for the data product manager and dictionary service.  _(@Dave)_
  - Speaker 1 will create tickets for the data product manager and dictionary service.  _(@Speaker 1)_
  - Dave will investigate why some vehicles are not registering apps after permissions change.  _(@Dave)_
  - Paul Slater created a ticket today.  _(@Paul Slater)_

### [Halo] Stand Up  
_(11200 chars, recording 836689aa-14ef-41ac-822e-a7cf41c68982)_

**Arm A (current + llama3.2):**
- decisions:
  - stand up
  - disable scroll search via feature toggle
- actions:
  - review CCEM ticket  _(@Zakir)_
  - review SGM service  _(@Zakir)_
  - update onboard header table  _(@Sukumar)_
  - review and test publisher service  _(@Anika)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - It was decided that someone should look into the subscriber service persistent sessions issue.
  - It was decided that a sensible string can be put into the application field for data products.
  - It was decided that the team should be okay without a support call at half 10.
- actions:
  - Dave will monitor observability events for DCSE.  _(@Dave)_
  - Kelly sent the latest one to someone.  _(@Kelly)_
  - Dave will look to see if he can pick something up and monitor in the background.  _(@Dave)_
  - Kelly will look into setting a TTL and observability events.  _(@Kelly)_
  - Someone will start the persistent sessions issue.
  - Someone will create a ticket around the dictionary service API.
  - Someone will investigate GitLab connectivity issues.
  - Someone will chase the sims ticketer.
  - Mariano will set up some sessions this week to go through the epics.  _(@Mariano)_
  - Sonika will put the Friday leave into the calendar.  _(@Sonika)_
  - Sukumar will work on updating the onboard header table.  _(@Sukumar)_

### Catch Up  
_(8470 chars, recording a2d03fa2-c17c-4a94-ab9e-eff9d62eeaa5)_

**Arm A (current + llama3.2):**
- decisions:
  - join forces for this with the help of Kiro or with the help of our devs
  - make other people within the team a bit more accountable
- actions:
  - assign task to Dave  _(@Kelly)_
  - review and provide feedback  _(@Dave)_
  - coordinate with Marianna  _(@Kelly)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - A meeting will be held tomorrow.
  - The teams will join forces with the help of Kiro or our devs.
  - Someone from the team will review the work and agree that it fulfills goals.
  - The team will have a catch up with Dave to understand if the suggested work is needed.
  - Dave's time might impact the team's ability to complete deliverables in the PI.
- actions:
  - Dave will be checked with tomorrow to know about the architectural decision.  _(@Nikki)_
  - Marianna will be forwarded the meeting invite.  _(@Kelly)_
  - Dave and Doc will review the conference features.  _(@Dave)_
  - Someone from the team will review the POC created by Chetan and Kiro.  _(@Shelley)_
  - A risk will be raised about the less availability or people busy with other priorities.  _(@Kelly)_

### Recovery from GitLab and Discussion of Various Projects  
_(10894 chars, recording 5a85d927-5ddc-4e24-a675-c951cd88f182)_

**Arm A (current + llama3.2):**
- decisions:
  - We'll deliver your message, but it's up to those guys to verify that everything's working.
- actions:
  - Send tickets for reactive, visioning and enablement stuff to Steve  _(@Sard)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - It was decided to proceed with version control.
  - It was decided to drop the legacy VA controls, manifest, and error messages.
  - It was decided to deliver the message, but it's up to those guys to verify that everything's working.
- actions:
  - Dave will poke the contact for a rig if he doesn't hear back.  _(@Dave)_
  - Sanika will continue testing with SGM.  _(@Sanika)_
  - Grace will get approvals on the sneak issues tickets in review.  _(@Grace)_
  - Dave will update some of the requirements.  _(@Dave)_
  - Dave will review changes for meds.  _(@Dave)_
  - Dave will progress the pipeline and double check the S3 configuration in AWS.  _(@Dave)_
  - Dave will send the tickets for the reactive vehicle to Steve.  _(@Dave)_
  - Anupal will continue working on the dictionary service ticket.  _(@Anupal)_
  - Anupal will raise a security issue regarding GitLab password attempts.  _(@Anupal)_

### VA Roll Out Issue Triage  
_(14036 chars, recording 992e9efc-cc49-46bf-98b6-6d5feaa8080d)_

**Arm A (current + llama3.2):**
- decisions:
  - we need to make some changes on this mapping table
- actions:
  - identify the team that processes that message and sets the consent  _(@Kelly)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team will try to identify the team responsible for the consent key and bring the team into communication on this.
- actions:
  - I'll dig out the last name of Ben.  _(@Kelly)_
  - We'll try our best to see, like, if we can identify the team that is responsible for this work.  _(@Chris)_
  - Kelly will check with Matt DeLi regarding permission label experience.  _(@Kelly)_
  - Kelly will check with Chris Newton regarding permission label and consent key.  _(@Kelly)_
  - Someone will forward the specific lucid list so we can try internally to find out within VCDP who owns this piece.  _(@Chris)_
  - Someone will paste the topic and channel that is basically all of these messages are being sent.  _(@Chris)_

### Discussion on the goals of 26_PI_3 of VDRP  
_(19793 chars, recording 0e3ed53c-9612-425b-99e8-7089c52eca5e)_

**Arm A (current + llama3.2):**
- decisions:
  - Agreed on ways of working
  - Assigned deliverables
  - Created workspace
  - Reviewed spec
  - Decided to use Kiro for analysis
- actions:
  - Review spec and assign deliverables  _(@Nikki)_
  - Create workspace and review spec  _(@Chetan)_
  - Review code and assign tasks  _(@Mariana)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - Nikki’s team will do the development in conjunction with Kiro, and the data product manager team will do a review of the work.
  - Dave agreed that Nikki’s team can do the development in conjunction with Kiro, and the data product manager team will do a review of the work.
  - The team will have a weekly catch-up with Dave and Kelly to check that user stories are in the correct format and sequence.
- actions:
  - Dave will have a look at the user stories before changes are made.  _(@Dave)_
  - Nikki will have a catch up with Mariana about big room planning and ways of working.  _(@Nikki)_
  - Chetan will show the codebase, including VDRP front end code, the UI code, GUI, the data request handler, API gateway code base and DPM code base.  _(@Chetan)_

### Discussion on the goals of 26_PI_3 of VDRP  
_(7202 chars, recording ee76581a-ca59-4e43-9f33-a1c978ae2edf)_

**Arm A (current + llama3.2):**
- decisions:
  - accept the mission
- actions:
  - Start that clock  _(@0800-7319-333)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - Walter White from Breaking Bad is an example of a baddie who was really a goodie.
  - Godzilla is an example of a baddie who was really a goodie.
  - Ebenezer Scrooge is an example of a baddie who turned out all right.
- actions:
  - Look at the seven goodies or baddies who turned out to be okay.
  - Start the clock.

### Third-Party Integration Challenges and Escalation  
_(25060 chars, recording 182e2742-d0d2-403b-8b37-792bec6e4d09)_

**Arm A (current + llama3.2):**
- decisions:
  - We are not accepting a level of accountability if you like.
- actions:
  - Have some historic information to leave to move on  _(@Sebastian)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team agreed to give Mark a chance to get involved before escalating the issue to Paul and Alex.
  - The team agreed that escalating the issue to Paul and Alex might be a waste of time.
  - The team agreed that they are not accepting a level of accountability.
  - The team agreed that they have met their side of the contract.
  - The team agreed to go with Sebastian's architecture for central logging.
  - The team agreed to not worry about Vanessa's change for the first instance.
- actions:
  - Bhuvanesh will speak with Bilvanesh to see how to phrase the concerns.  _(@Bhuvanesh)_
  - Someone will grab the meeting minutes and send them on.  _(@Sebastian)_
  - Glenn and Sha will be assigned to a ticket.  _(@Glenn)_
  - Create a ticket in JIRA to document any findings.

### Event Driven Data Collect Health Review  
_(48911 chars, recording 5a608b52-3ba7-4f95-86c4-6a8c15d9fc69)_

**Arm A (current + llama3.2):**
- decisions:
  - Assign the ticket to Matt Dilley
  - Move the ticket to an approval
  - Reassign the ticket to Kelly
  - Drop the ticket into sprint one
  - Size the work for sprint one
  - Reassign the ticket to Kelly
  - Move the ticket to an approval
  - Reassign the ticket to Kelly
  - Drop the ticket into sprint one
  - Size the work for sprint one
  - Reassign the ticket to Kelly
  - Move the ticket to an approval
  - Reassign the ticket to Kelly
  - Drop the ticket into sprint one
  - Size the work for sprint one
- actions:
  - Assign the ticket to Matt Dilley  _(@Kelly)_
  - Move the ticket to an approval  _(@Kelly)_
  - Reassign the ticket to Kelly  _(@Kelly)_
  - Drop the ticket into sprint one  _(@Kelly)_
  - Size the work for sprint one  _(@Kelly)_
  - Reassign the ticket to Kelly  _(@Kelly)_
  - Move the ticket to an approval  _(@Kelly)_
  - Reassign the ticket to Kelly  _(@Kelly)_
  - Drop the ticket into sprint one  _(@Kelly)_
  - Size the work for sprint one  _(@Kelly)_
  - Reassign the ticket to Kelly  _(@Kelly)_
  - Move the ticket to an approval  _(@Kelly)_
  - Reassign the ticket to Kelly  _(@Kelly)_
  - Drop the ticket into sprint one  _(@Kelly)_
  - Size the work for sprint one  _(@Kelly)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The merged ones can be retested.
  - The raised ones will be in the next build.
  - The priority two bug should be moved to one side.
  - The team will work with the team to get that merge somehow.
  - The ticket should be assigned back to Kelly.
  - Matt Dilley will be contacted regarding the data product issue.
- actions:
  - Manu will check with Liam Evans to confirm the IP17 cutoff date.  _(@Manu)_
  - Manu will create a group chat with Chandra, Kelly, Mariana, and Doc to discuss the SGA manifest issue.  _(@Manu)_
  - Dave will add Kelly and Mariana to the chats.  _(@Dave)_
  - Manu will assign the ticket to Matt.  _(@Manu)_
  - Elish will ping the SIMs and group chat.  _(@Elish)_
  - Kelly will assign the ticket back to herself.  _(@Kelly)_

### [Halo] Stand Up  
_(6696 chars, recording 61f66c3e-cc2c-4ac6-b2ce-bfd7bc85b2cd)_

**Arm A (current + llama3.2):**
- decisions:
  - let's just build it and then we'll find little things
- actions:
  - review SAD tickets  _(@Dave)_

**Arm C (grounded + gemma3:12b):**
- decisions:
  - The team decided to draw a line and just build the system, and then bolt on things later.
- actions:
  - Someone will have a look at the logs for TPD or SAD.
  - Seneca will confirm if the changes are in pre-prod.  _(@Seneca)_
  - Daik will link the Jira tickets to the epics.  _(@Daik)_
  - Brian will contact someone to test DCSE stuff.  _(@Brian)_
  - Steve will have a look at the subscriber service again after this call.  _(@Steve)_
  - Dave will share his markdown file with everyone.  _(@Dave)_
  - SAD will review the tickets.  _(@SAD)_

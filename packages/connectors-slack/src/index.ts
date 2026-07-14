// Connector contract (LOCAL MIRROR — reconcile with @hidock/connector-host once it lands).
export type {
  ActionInput,
  ActionProvider,
  ActionResult,
  Connector,
  ConnectorAction,
  ConnectorCapabilities,
  ConnectorStatus,
  ConnectorStatusState,
  Contact,
  EntityRef,
  Enrichment,
  ExternalPerson,
  GraphSignal,
  IdentityProvider,
  PullResult,
  SignalProvider,
  SourceContainer,
  SourceItem,
  SourceProvider
} from './contract.js'

// Slack API + config types
export type {
  SlackChannel,
  SlackClientDeps,
  SlackConnectorConfig,
  SlackFile,
  SlackMessage,
  SlackUser,
  SlackUserProfile
} from './types.js'

// Web API client
export {
  SlackApiError,
  SlackClient,
  SlackRateLimitError,
  type HistoryParams,
  type RepliesParams
} from './slack-client.js'

// Entity mapping
export {
  bestName,
  channelToSourceContainer,
  fileRef,
  messageRef,
  messageToSourceItems,
  parseMentions,
  renderText,
  tsToIso,
  userToEnrichment,
  userToExternalPerson,
  type MappingContext
} from './entity-mapping.js'

// Sync
export { compareTs, maxTs, syncChannel, type SyncChannelOptions } from './sync.js'

// Connector + host registration (descriptor + context-bound factory)
export {
  createSlackConnector,
  slackConnectorFactory,
  slackDescriptor,
  SLACK_CONNECTOR_TYPE,
  SLACK_REQUIRED_SCOPES,
  SlackConnector
} from './slack-connector.js'

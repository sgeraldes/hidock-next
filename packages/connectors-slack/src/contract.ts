/**
 * Connector-host contract — RECONCILED to the canonical source.
 *
 * As of 2026-07-09 the connector-host package `@hidock/connectors`
 * (`packages/connectors/src/types.ts`, committed b99ad7b9) is the single source
 * of truth. It adopted this connector's mirror shapes verbatim, so the earlier
 * local mirror has been replaced by direct re-exports — zero drift, one source.
 *
 * The rest of this package imports these names from './contract.js', so this is
 * the only file that references the host package for the base contract types
 * (registration types — ConnectorDescriptor / ConnectorFactory / ConnectorContext
 * — are imported directly from '@hidock/connectors' where used).
 */

export type {
  ConnectorStatusState,
  ConnectorStatus,
  ExternalPerson,
  Contact,
  Enrichment,
  SourceContainer,
  SourceItem,
  PullResult,
  EntityRef,
  ConnectorAction,
  ActionInput,
  ActionResult,
  GraphSignal,
  IdentityProvider,
  SourceProvider,
  ActionProvider,
  SignalProvider,
  ConnectorCapabilities,
  Connector
} from '@hidock/connectors'

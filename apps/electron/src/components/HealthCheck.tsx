import { useState } from 'react'
import { AlertCircle, CheckCircle2, AlertTriangle, RefreshCw, Wrench, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

interface IntegrityIssue {
  id: string
  type: string
  severity: 'low' | 'medium' | 'high'
  description: string
  filePath?: string
  filename?: string
  recordingId?: string
  suggestedAction: string
  autoRepairable: boolean
  details?: Record<string, unknown>
}

interface IntegrityReport {
  scanStarted: string
  scanCompleted: string
  totalIssues: number
  issuesByType: Record<string, number>
  issuesBySeverity: Record<string, number>
  issues: IntegrityIssue[]
  autoRepairableCount: number
}

interface RepairResult {
  issueId: string
  success: boolean
  action: string
  error?: string
}

export function HealthCheck() {
  const [scanning, setScanning] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [repairResults, setRepairResults] = useState<RepairResult[]>([])
  const [showDetails, setShowDetails] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runScan = async () => {
    setScanning(true)
    setError(null)
    setRepairResults([])
    try {
      const result = await window.electronAPI.integrity.runScan()
      setReport(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run health check')
    } finally {
      setScanning(false)
    }
  }

  const repairAll = async () => {
    if (!report) return
    setRepairing(true)
    setError(null)
    try {
      const results = await window.electronAPI.integrity.repairAll()
      setRepairResults(results)
      // Re-run scan to update the report
      const newReport = await window.electronAPI.integrity.runScan()
      setReport(newReport)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to repair issues')
    } finally {
      setRepairing(false)
    }
  }

  const getSeverityIcon = (severity: 'low' | 'medium' | 'high') => {
    switch (severity) {
      case 'high':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      case 'medium':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case 'low':
        return <AlertCircle className="h-4 w-4 text-blue-500" />
    }
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      orphaned_download: 'Orphaned Download',
      missing_file: 'Missing File',
      orphaned_file: 'Orphaned File',
      date_mismatch: 'Date Mismatch',
      size_mismatch: 'Size Mismatch',
      incomplete_download: 'Incomplete Download'
    }
    return labels[type] || type
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Health Check</CardTitle>
        <CardDescription>
          Scan for and repair data integrity issues (orphaned downloads, missing files, wrong dates)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button onClick={runScan} disabled={scanning || repairing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Run Health Check'}
          </Button>

          {report && report.autoRepairableCount > 0 && (
            <Button variant="outline" onClick={repairAll} disabled={scanning || repairing}>
              <Wrench className={`h-4 w-4 mr-2 ${repairing ? 'animate-spin' : ''}`} />
              {repairing ? 'Repairing...' : `Repair All (${report.autoRepairableCount})`}
            </Button>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Repair Results */}
        {repairResults.length > 0 && (
          <div className="p-3 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-900 rounded-lg text-sm">
            <div className="font-medium text-green-700 dark:text-green-400 mb-1">
              Repair Complete
            </div>
            <div className="text-green-600 dark:text-green-500">
              {repairResults.filter(r => r.success).length} of {repairResults.length} issues repaired successfully
            </div>
          </div>
        )}

        {/* Report Summary */}
        {report && (
          <div className="space-y-3">
            {report.totalIssues === 0 ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-900 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-green-700 dark:text-green-400">All data integrity checks passed</span>
              </div>
            ) : (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <div className="text-2xl font-bold">{report.totalIssues}</div>
                    <div className="text-xs text-muted-foreground">Total Issues</div>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <div className="text-2xl font-bold text-red-500">
                      {report.issuesBySeverity['high'] || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">High Severity</div>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-500">
                      {report.autoRepairableCount}
                    </div>
                    <div className="text-xs text-muted-foreground">Auto-Repairable</div>
                  </div>
                </div>

                {/* Issues by Type */}
                <div className="text-sm">
                  <div className="font-medium mb-2">Issues by Type:</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(report.issuesByType).map(([type, count]) => (
                      <span
                        key={type}
                        className="px-2 py-1 bg-muted rounded text-xs"
                      >
                        {getTypeLabel(type)}: {count}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Expand/Collapse Details */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDetails(!showDetails)}
                  className="w-full"
                >
                  {showDetails ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-2" /> Hide Details
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-2" /> Show Details ({report.issues.length} issues)
                    </>
                  )}
                </Button>

                {/* Issue Details */}
                {showDetails && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {report.issues.map((issue) => (
                      <div
                        key={issue.id}
                        className="p-3 bg-muted/30 rounded-lg text-sm"
                      >
                        <div className="flex items-start gap-2">
                          {getSeverityIcon(issue.severity)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{getTypeLabel(issue.type)}</div>
                            <div className="text-muted-foreground text-xs truncate">
                              {issue.description}
                            </div>
                            {issue.filename && (
                              <div className="text-xs text-muted-foreground mt-1">
                                File: {issue.filename}
                              </div>
                            )}
                          </div>
                          {issue.autoRepairable && (
                            <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 rounded">
                              Auto-fix
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Scan Timestamp */}
            <div className="text-xs text-muted-foreground text-center">
              Last scan: {new Date(report.scanCompleted).toLocaleString()}
            </div>
          </div>
        )}

        {/* Initial State */}
        {!report && !scanning && (
          <div className="text-sm text-muted-foreground text-center py-4">
            Run a health check to scan for data integrity issues
          </div>
        )}
      </CardContent>
    </Card>
  )
}

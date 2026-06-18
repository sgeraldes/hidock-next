interface MetricTileProps {
  label: string
  value: string | number
  detail: string
}

export function MetricTile({ label, value, detail }: MetricTileProps): JSX.Element {
  return (
    <section className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  )
}

export default function Loading() {
  return (
    <div aria-busy="true">
      <span className="sk" style={{ width: 220, height: 22, marginBottom: 8 }} />
      <span className="sk" style={{ width: 360, height: 14, marginBottom: 20 }} />
      <span className="sk" style={{ width: '100%', height: 84, marginBottom: 16 }} />
      <span className="sk" style={{ width: '100%', height: 320 }} />
    </div>
  )
}

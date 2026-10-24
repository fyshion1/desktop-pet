// Display normalization only: preserve the server's original conversation log.
export function visibleReply(value) {
  return String(value || '').replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:think|thinking)\b[^>]*>[\s\S]*$/gi, '').trim()
}
export function replySegments(row, fallback = '') {
  const supplied = Array.isArray(row?.segments) ? row.segments
    .map(s => ({ ...s, text: visibleReply(s.text) })).filter(s => s.text) : []
  if (supplied.length) return supplied
  const content = visibleReply(row?.content)
  const matches = [...content.matchAll(/^\s*\*\*([^*\n]+)\*\*\s*[：:]?\s*/gm)]
  if (matches.length) return matches.map((m, i) => ({ speaker: m[1],
    text: content.slice(m.index + m[0].length, matches[i + 1]?.index ?? content.length).trim() })).filter(s => s.text)
  return content ? [{ speaker: fallback, text: content }] : []
}

// Previous comment on line 54 replaced with updated context
const icon = isBill ? '💵' : '🪙';
// Updated line 62:
text: `💵 $${bill} (${counts[bill] || 0})`
// Updated comment on line 77-78 reflecting change without flags
// Updated line 91:
text: `${icon} ${label} (${counts[denom] || 0})`
// "Report a problem": opens the person's own email app with a draft. Nothing is sent by Cornerfold;
// the draft goes nowhere unless they press send, and they can edit or delete any line first.
// It never includes anything about their documents, only the app version and the browser's name.
const ADDRESS = 'hello@cornerfold.org'

export function reportHref(version: string, userAgent: string) {
  const body = ['What happened?', '', '', '', '---', 'You can delete the lines below before sending.', `Cornerfold ${version}`, `Browser: ${userAgent}`].join('\r\n')
  return `mailto:${ADDRESS}?subject=${encodeURIComponent('Cornerfold problem')}&body=${encodeURIComponent(body)}`
}

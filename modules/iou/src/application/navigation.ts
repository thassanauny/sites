export function route(hash = window.location.hash) {
  const group = /^#\/group\/([a-f0-9]{32})(\/log)?$/.exec(hash)
  const join = /^#\/join\/([a-f0-9]{32})$/.exec(hash)
  const home = ['', '#', '#/'].includes(hash)
  const groups = hash === '#/groups'
  const transactions = hash === '#/transactions'
  return {
    groupCode: group?.[1],
    groups,
    transactions,
    log: Boolean(group?.[2]),
    joinCode: join?.[1],
    invalid: !home && !groups && !transactions && !group && !join,
  }
}

export function navigate(inviteCode?: string, log = false) {
  window.location.hash = inviteCode ? `/group/${inviteCode}${log ? '/log' : ''}` : '/'
}

export function navigateGroups() {
  window.location.hash = '/groups'
}

export function navigateTransactions() {
  window.location.hash = '/transactions'
}

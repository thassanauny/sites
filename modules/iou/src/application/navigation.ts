export function route(hash = window.location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/')
  return {
    groupCode: parts[0] === 'group' ? parts[1] : undefined,
    groups: parts[0] === 'groups',
    transactions: parts[0] === 'transactions',
    log: parts[0] === 'group' && parts[2] === 'log',
    joinCode: parts[0] === 'join' ? parts[1] : undefined,
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

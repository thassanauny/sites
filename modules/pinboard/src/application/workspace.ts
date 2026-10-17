export const routeCode = () =>
  /^#\/?(?:board|join)\/([a-f0-9]{32})$/i.exec(window.location.hash)?.[1].toLowerCase() ?? '';
export const routeInvitation = () =>
  /^#\/?join\/([a-f0-9]{32})$/i.exec(window.location.hash)?.[1].toLowerCase() ?? '';

export const routeCode = () =>
  /^#board\/([a-f0-9]{32})$/i.exec(window.location.hash)?.[1].toLowerCase() ?? '';
export const invalidRoute = () => !['', '#', '#/'].includes(window.location.hash) && !routeCode();

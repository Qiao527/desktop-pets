// Insights window bridge (sandboxed preload). Exposes four calls only;
// arguments are coerced to the types main expects.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("insights", {
  getState: () => ipcRenderer.invoke("insights:get-state"),
  setTracking: (enabled) => ipcRenderer.invoke("insights:set-tracking", enabled === true),
  deleteAll: () => ipcRenderer.invoke("insights:delete-all"),
  openSettings: (pane) => ipcRenderer.invoke("insights:open-settings", String(pane)),
});

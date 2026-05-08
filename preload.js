// Electron preload script — bridge tussen renderer (HTML-pagina's) en
// main.js. We gebruiken contextIsolation:true (in createWindow), dus
// de renderer kan niet rechtstreeks bij Electron-API's. Dit script
// definieert een minimale veilige bridge via contextBridge.
//
// Toegevoegd tot nu toe:
//   • fonteynPrint.silentPrintLabels(opts)
//       → laat main.js een silent print uitvoeren naar een specifieke
//         printer met landscape-orientatie. Voor de labels.html
//         "Alle labels printen"-knop, die anders elke keer een
//         systeem-print-dialog opende waar de user printer + orientatie
//         handmatig moest kiezen.
//   • fonteynPrint.listPrinters()
//       → geeft de lijst beschikbare printers terug. Handig voor debug
//         of voor een "kies printer"-dropdown.
//   • fonteynPrint.isAvailable
//       → boolean zodat de HTML kan detecteren of we in Electron draaien
//         (en dus silent-print kunnen) of in een gewone browser-context.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fonteynPrint", {
  isAvailable: true,
  silentPrintLabels: (opts) => ipcRenderer.invoke("fonteyn:print-labels", opts),
  listPrinters: () => ipcRenderer.invoke("fonteyn:list-printers"),
});

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

// Apparaat-info voor het activiteitenlogboek. Zonder dit was bij een
// onverwachte inlog niet te achterhalen op wélke computer dat gebeurde.
// Alleen platform, computernaam en app-versie — geen persoonlijke gegevens.
contextBridge.exposeInMainWorld("fonteynApp", {
  versie: process.env.npm_package_version || require("./package.json").version,
  platform: process.platform,          // "darwin" | "win32"
  computer: require("os").hostname(),
});

contextBridge.exposeInMainWorld("fonteynPrint", {
  isAvailable: true,
  silentPrintLabels: (opts) => ipcRenderer.invoke("fonteyn:print-labels", opts),
  // Echte silent print mét door de renderer opgegeven paginamaat
  // (portrait 104×214). Kiest automatisch de ZDesigner en print zonder
  // systeem-dialoog. Aparte naam zodat oude shells dit NIET hebben →
  // labels.html valt dan veilig terug op window.print().
  printLabelsSilent: (opts) => ipcRenderer.invoke("fonteyn:print-labels-silent", opts),
  listPrinters: () => ipcRenderer.invoke("fonteyn:list-printers"),
  // Debug: schrijf de print-output naar een PDF op het bureaublad
  // i.p.v. naar de printer. Voor het verifiëren van page-size/orientation
  // zonder labels te verspillen.
  printLabelsToPdf: () => ipcRenderer.invoke("fonteyn:print-labels-to-pdf"),
});

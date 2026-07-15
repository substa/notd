# markd

Editor Markdown web ispirato all’esperienza minimale di Typora. Non usa framework o servizi esterni: i documenti restano nel browser o sul filesystem dell’utente.

## Avvio locale

```bash
python3 -m http.server 4173
```

Aprire [http://localhost:4173](http://localhost:4173).

L’app è interamente statica e può essere pubblicata su qualsiasi hosting HTTPS (GitHub Pages, Netlify, Vercel, nginx, ecc.). HTTPS abilita PWA e File System Access API nei browser compatibili.

## Funzioni

- interfaccia senza barre: la sidebar appare dal bordo sinistro o con `⌘/Ctrl + Shift + L`;
- formattazione digitando direttamente la sintassi Markdown (`**grassetto**`, `*corsivo*`, `` `codice` ``);
- il blocco selezionato mostra la sintassi Markdown, senza sfondo, e torna formattato quando perde il focus;
- navigazione tra blocchi con frecce o `Alt + ↑/↓`;
- palette completa richiamabile con `/`, `F1` o `⌘/Ctrl + Shift + P`;
- scorciatoie per file, ricerca, formattazione, navigazione e aspetto;
- editor visuale Markdown e modalità sorgente;
- titoli, link, citazioni, liste, task, codice e tabelle;
- apertura tramite file picker o drag and drop;
- salvataggio diretto su Chromium e download `.md` sugli altri browser;
- copie locali e documenti recenti;
- indice automatico, ricerca, conteggio parole;
- temi chiaro, seppia e scuro;
- esportazione HTML;
- layout desktop/mobile e funzionamento offline come PWA.

## Privacy

Nessun contenuto viene inviato a un server. Le copie automatiche sono memorizzate in `localStorage`; il service worker salva solamente gli asset dell’app per l’uso offline.

export async function recognizeReceipt(file, progress = () => {}, tesseract = globalThis.Tesseract) {
  if (file.type === 'application/pdf') return { cents: null, confidence: 'pdf', note: 'PDF gespeichert. Bitte den Gesamtbetrag aus dem Beleg eintragen.' };
  if (!tesseract?.createWorker) throw new Error('Die Texterkennung konnte nicht geladen werden. Du kannst den Betrag selbst eintragen.');
  progress('Quittung wird gelesen …');
  const creation = tesseract.createWorker('deu', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    logger: event => { if (event.status === 'recognizing text') progress('Quittung wird gelesen … ' + Math.round(event.progress * 100) + ' %'); },
  });
  let worker, timer, stopped = false;
  try {
    return await Promise.race([
      (async () => {
        worker = await creation;
        if (stopped) throw new Error('Texterkennung abgebrochen.');
        const { data } = await worker.recognize(file);
        return detectReceiptAmount(data.text);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Die Texterkennung dauert zu lange. Bitte den Betrag selbst eintragen.')), 60000); }),
    ]);
  } finally {
    stopped = true; clearTimeout(timer);
    if (worker) await worker.terminate();
    else void creation.then(lateWorker => lateWorker.terminate(), () => {});
  }
}

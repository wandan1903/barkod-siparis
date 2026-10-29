'use client';

import { useEffect, useRef, useState } from 'react';

// Üç yolla barkod alır:
// 1) USB / Bluetooth barkod okuyucu: klavye gibi yazar ve Enter'a basar (bakkallarda en yaygını).
// 2) Elle yazma.
// 3) Telefon kamerası: tarayıcı destekliyorsa (Android Chrome) BarcodeDetector ile.
export default function BarcodeInput({ onCode, autoFocus = true }) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const inputRef = useRef(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    setCameraSupported(
      typeof window !== 'undefined' &&
        'BarcodeDetector' in window &&
        !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    );
  }, []);

  useEffect(() => {
    if (!camera) return undefined;
    let stream = null;
    let stopped = false;
    let timer = null;
    let last = '';
    let lastAt = 0;

    async function start() {
      try {
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length) {
              const code = codes[0].rawValue;
              const now = Date.now();
              if (code && (code !== last || now - lastAt > 2000)) {
                last = code;
                lastAt = now;
                if (navigator.vibrate) navigator.vibrate(60);
                onCodeRef.current(code);
              }
            }
          } catch (e) {
            // Tek karede okuma hatası: bir sonraki karede yeniden denenir
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch (e) {
        setCameraError('Kameraya erişilemedi. Barkodu elle yazabilir ya da barkod okuyucu kullanabilirsiniz.');
        setCamera(false);
      }
    }

    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [camera]);

  function submit(event) {
    event.preventDefault();
    const code = value.replace(/\s/g, '');
    if (!code) return;
    onCodeRef.current(code);
    setValue('');
    if (inputRef.current) inputRef.current.focus();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {camera ? (
        <div className="scanner">
          <video ref={videoRef} muted playsInline />
          <div className="frame" />
        </div>
      ) : null}
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <label className="sr-only" htmlFor="barcode">Barkod</label>
        <input
          id="barcode"
          ref={inputRef}
          className="input"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Barkodu okutun veya yazın"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn primary" type="submit">Ekle</button>
      </form>
      {cameraSupported ? (
        <button type="button" className="btn outline" onClick={() => { setCameraError(''); setCamera(!camera); }}>
          {camera ? 'Kamerayı kapat' : 'Kamerayla okut'}
        </button>
      ) : null}
      {cameraError ? <div className="notice error small">{cameraError}</div> : null}
    </div>
  );
}

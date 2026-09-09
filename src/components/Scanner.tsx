import { useRef, useState, useEffect } from "react";
import type { Journey } from "../types";
import { Modal, Field, Notice, Button, Badge, useAsync } from "./ui";
export function Scanner({ journey, close }: { journey: Journey; close: () => void }) {
  const [recognized, setRecognized] = useState(""),
    [preview, setPreview] = useState(""),
    [progress, setProgress] = useState(""),
    [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const worker = useRef<import("tesseract.js").Worker | null>(null);
  // Set on unmount so an OCR worker still being created (createWorker() is async and can take
  // a moment on first use, while it downloads/instantiates the WASM core) is terminated the
  // instant it becomes available instead of leaking indefinitely -- the cleanup effect below
  // can only terminate `worker.current`, which is still null while creation is in flight.
  const cancelled = useRef(false);
  const { busy, error, run } = useAsync();
  const leg = journey.legs.find((l) => l.vehicleId) ?? journey.legs.find((l) => l.mode !== "walk")!;
  const expected = (leg.vehicleId ?? leg.service).match(/[\d]+/)?.[0];
  const match = expected && new RegExp(`(?:^|\\D)${expected}(?:\\D|$)`).test(recognized);
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      void worker.current?.terminate();
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );
  return (
    <Modal title="Is this your vehicle?" onClose={close}>
      <p>
        Look for <b>{leg.service}</b>
        {leg.vehicleId ? ` · ${leg.vehicleId}` : ""} toward <b>{leg.to}</b>.
      </p>
      <Notice>
        Text recognition helps compare signs; it cannot verify a vehicle’s identity. Read the
        destination and confirm with the driver.
      </Notice>
      <div className="stack">
        <Field label="Take or choose a sign photo">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void run(async () => {
                if (f.size > 8_000_000) throw new Error("Choose a photo smaller than 8 MB.");
                setPreview(URL.createObjectURL(f));
                setProgress("Loading local text recognition…");
                const { createWorker } = await import("tesseract.js");
                const created = await createWorker("eng", 1, {
                  // Served locally (public/ocr/, bundled from the tesseract.js/tesseract.js-core
                  // packages this project already depends on) so recognition works without a
                  // third-party worker/core host and matches "processed in this browser, not
                  // uploaded" below. Only the SIMD and plain WASM core variants are bundled
                  // (not relaxed-SIMD) to keep the OCR asset bundle a reasonable size; both
                  // support LSTM-only mode, which is all this worker uses (oem=1 below).
                  workerPath: "/ocr/worker.min.js",
                  corePath: "/ocr/",
                  langPath: "https://tessdata.projectnaptha.com/4.0.0",
                  logger: (m) => {
                    if (!cancelled.current)
                      setProgress(`${m.status} ${Math.round((m.progress ?? 0) * 100)}%`);
                  },
                });
                if (cancelled.current) {
                  // The modal was closed while the worker was still being created (this can
                  // take a moment on first use, downloading/instantiating the WASM core). It
                  // was never assigned to worker.current, so the unmount cleanup effect could
                  // not terminate it -- do that now, immediately, instead of leaking it.
                  await created.terminate();
                  return;
                }
                worker.current = created;
                const { data } = await worker.current.recognize(f);
                if (cancelled.current) return;
                setRecognized(data.text);
                await worker.current.terminate();
                worker.current = null;
                setProgress("Recognition complete. Review the text below.");
              });
            }}
          />
        </Field>
        {preview && <img className="scan-preview" src={preview} alt="Your selected vehicle sign" />}
        {busy && <p role="status">{progress}</p>}
        {error && <Notice tone="error">{error} You can enter the sign text below.</Notice>}
        <Field label="Recognized or manually entered text">
          <textarea
            value={recognized}
            onChange={(e) => setRecognized(e.target.value)}
            placeholder="Enter the route number and destination from the sign."
          />
        </Field>
        {recognized && (
          <Notice tone={match ? "" : "amber"}>
            <b>{match ? "Expected number found in text." : "The expected number was not found."}</b>{" "}
            {match
              ? "Confirm the operator and destination before boarding."
              : "Check the route manually; OCR may have missed characters."}
          </Notice>
        )}
        <Button
          onClick={() =>
            void run(async () => {
              if (camera) {
                stream.current?.getTracks().forEach((t) => t.stop());
                setCamera(false);
                return;
              }
              if (!navigator.mediaDevices?.getUserMedia)
                throw new Error("Camera access is unavailable. Use a photo above.");
              stream.current = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
                audio: false,
              });
              setCamera(true);
              setTimeout(() => {
                if (video.current) video.current.srcObject = stream.current;
              }, 0);
            })
          }
        >
          {camera ? "Close camera" : "Open camera checklist"}
        </Button>
        {camera && (
          <div className="camera-guide">
            <video ref={video} autoPlay playsInline muted />
            <div>
              <Badge>BOARDING CHECKLIST</Badge>
              <p>
                1. Match {leg.service}
                <br />
                2. Confirm {leg.to}
                <br />
                3. Ask the driver if uncertain
              </p>
            </div>
          </div>
        )}
        <p className="fine-print">
          Photos are processed in this browser, not uploaded. First use downloads OCR language data.
          This checklist is not AR positioning or indoor navigation.
        </p>
      </div>
    </Modal>
  );
}

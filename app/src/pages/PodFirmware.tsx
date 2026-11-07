import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, Download, Info, Loader, WifiOff } from "lucide-react";
import type { InfoResponse } from "../pod/protocol";
import { downloadImage, fetchManifest, FirmwareError, type FirmwareImage, type ReleaseManifest, updateStatus } from "../pod/firmwareUpdate";
import { hasFeature } from "../pod/session";
import { firmwareCache } from "../store/firmwareCache";
import { PROGRAM_FORMAT } from "@reactpod/program-model";
import page from "./Page.module.css";
import styles from "./PodPage.module.css";

type Release = { manifest: ReleaseManifest; fresh: boolean };

/**
 * The release from the server; without a connection (or without a valid manifest) the one stored
 * at the last check. Null = no information at all.
 */
export async function loadRelease(): Promise<Release | null> {
  const fresh = await fetchManifest();
  if (fresh) {
    await firmwareCache.putManifest(fresh).catch(() => undefined);
    return { manifest: fresh, fresh: true };
  }
  const stored = await firmwareCache.getManifest().catch(() => null);
  return stored ? { manifest: stored, fresh: false } : null;
}

/** 1.1 MB: the image size in decimal megabytes; the space is a no-break one, so "1.1 MB" never wraps. */
export function formatMegabytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / 1_000_000).replace(/\s/, " ");
}

/**
 * Pod software on This set: installed and available version, the download for offline use, and the
 * Update action. `onUpdate` gets the version and a function that yields the verified image (stored or downloaded,
 * the first step of the update); without it no Update button is shown.
 */
export function FirmwareCard({ info, onUpdate }: { info: InfoResponse; onUpdate?: (version: string, prepare: () => Promise<FirmwareImage>) => void }) {
  const { t, i18n } = useTranslation();
  // undefined = still checking
  const [release, setRelease] = useState<Release | null | undefined>(undefined);
  const [stored, setStored] = useState<FirmwareImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const found = await loadRelease();
      const image = await firmwareCache.getImage().catch(() => null);
      if (alive) {
        setRelease(found);
        setStored(image);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const manifest = release?.manifest;
  const status = manifest ? updateStatus(info.firmware, manifest.version) : "unknown";
  const ota = hasFeature(info, "ota");
  // the image in the cache is usable only for the release it was downloaded for
  const cached = stored && manifest && stored.version === manifest.version && stored.sha256 === manifest.image.sha256 ? stored : null;
  const formatDiffers = !!manifest && manifest.programFormat !== (info.programFormat ?? 1);

  // the image for an update: the stored one, or downloaded now (the first step of Update)
  const prepare = async (release: ReleaseManifest): Promise<FirmwareImage> => {
    if (cached) return cached;
    const image = await downloadImage(release);
    await firmwareCache.putImage(image);
    setStored(image);
    return image;
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof FirmwareError ? e.code : "download");
    } finally {
      setBusy(false);
    }
  };

  const size = (bytes: number) => formatMegabytes(bytes, i18n.language);

  let message: string;
  if (release === undefined) message = t("firmware.checking");
  else if (!manifest) message = t("firmware.noRelease");
  else if (status === "upToDate") message = t("firmware.upToDate");
  else if (status === "available") message = ota ? t("firmware.available", { version: manifest.version }) : t("firmware.availableUsb", { version: manifest.version });
  else message = t("firmware.noRelease");

  return (
    <section className={page.section}>
      <h2>
        <Download size={16} aria-hidden /> {t("firmware.title")}
      </h2>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{t("firmware.installed")}</dt>
          <dd>{info.firmware}</dd>
        </div>
        {manifest && (
          <div className={styles.fact}>
            <dt>{t("firmware.release")}</dt>
            <dd>{manifest.version}</dd>
          </div>
        )}
      </dl>
      <p className={status === "available" ? styles.warn : styles.note}>
        {status === "upToDate" && <CircleCheck size={14} aria-hidden />} {message}
      </p>
      {release && !release.fresh && (
        <p className={styles.note}>
          <WifiOff size={14} aria-hidden /> {t("firmware.offline")}
        </p>
      )}
      {formatDiffers && (
        <p className={styles.note}>
          <Info size={14} aria-hidden /> {t("firmware.programFormat", { release: manifest.programFormat, pod: info.programFormat ?? 1, app: PROGRAM_FORMAT })}
        </p>
      )}
      {manifest && status === "available" && ota && (
        <div className={styles.firmwareActions}>
          {cached ? (
            <p className={styles.note}>{t("firmware.stored", { version: cached.version, size: size(cached.size) })}</p>
          ) : release?.fresh ? (
            <button
              className={styles.textButton}
              onClick={() => void run(async () => void (await prepare(manifest)))}
              disabled={busy}
            >
              {busy ? <Loader size={18} aria-hidden className={styles.spin} /> : <Download size={18} aria-hidden />}
              {t("firmware.download", { size: size(manifest.image.size) })}
            </button>
          ) : (
            <p className={styles.note}>{t("firmware.notStoredOffline")}</p>
          )}
          {onUpdate && (
            <button
              className={`${styles.textButton} ${styles.primaryButton}`}
              onClick={() => onUpdate(manifest.version, () => prepare(manifest))}
              disabled={busy || (!release?.fresh && !cached)}
            >
              {t("firmware.update")}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className={styles.warn} role="alert">
          {t(`firmware.errors.${error}`)}
        </p>
      )}
    </section>
  );
}

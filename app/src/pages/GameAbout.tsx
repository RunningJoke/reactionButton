/** About mode of the game page: what happens, the settings, where the game is, and what to do next. */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Play, Settings2 } from "lucide-react";
import { Named } from "../components/Named";
import { BlockDetailsSheet, IssueList } from "../editor/BlockDetails";
import { useExpertMode } from "../editor/expertMode";
import { ProgramColumnView } from "../editor/ProgramColumnView";
import { isMsSetting, tweakableSettings } from "../editor/settingLabels";
import type { GraphNode, ProgramGraph } from "../model/graph";
import { programTimeLimit } from "../programs/programSwitches";
import { podProgramFormat } from "../programs/sources";
import { summaryOf } from "../programs/requirements";
import type { GameMode, SourceId } from "../programs/sources";
import { usePodSession } from "../pod/session";
import { formatMs } from "../results/stats";
import { storyOf, type ResolvedProgram } from "@reactpod/program-model";
import styles from "./Game.module.css";

type Props = {
  sourceId: SourceId;
  path: string;
  json: Record<string, unknown>;
  isProgram: boolean;
  resolved: ResolvedProgram;
  graph: ProgramGraph;
  mine: boolean;
  copyLabel: string;
  onMode: (mode: GameMode) => void;
  onCopy: () => void;
  /** opens the game settings panel (my games only; a shipped game is read-only) */
  onSettings: () => void;
};

export function GameAbout({ path, json, isProgram, resolved, graph, mine, copyLabel, onMode, onCopy, onSettings }: Props) {
  const { t, i18n } = useTranslation();
  const [expert] = useExpertMode();
  const [selected, setSelected] = useState<string | null>(null);
  const story = storyOf(json, i18n.language) ?? summaryOf(typeof json.description === "string" ? json.description : undefined);
  const peripherals = Number(json.peripherals ?? 0);
  const settings = useMemo(() => tweakableSettings(resolved.variables, resolved.blocks.map((b) => b.block)), [resolved]);
  const timeLimit = programTimeLimit(json);
  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const showBlocks = isProgram ? expert : true;

  if (!isProgram) {
    return (
      <div className={styles.about}>
        {typeof json.description === "string" && <p className={styles.muted}>{json.description}</p>}
        <BlocksView graph={graph} selected={selected} onSelect={setSelected} node={selectedNode} />
      </div>
    );
  }

  const value = (name: string) => {
    const v = resolved.variables[name];
    if (typeof v !== "number") return String(v ?? "");
    return isMsSetting(name) ? formatMs(v, t("wizard.numberLocale")) : String(v);
  };

  return (
    <div className={styles.about}>
      {story && (
        <section className={styles.card} aria-label={t("game.story")}>
          <h3>{t("game.story")}</h3>
          {story.split(/\n+/).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </section>
      )}

      <section className={styles.card} aria-label={t("game.settingsTitle")}>
        <div className={styles.cardHead}>
          <h3>{t("game.settingsTitle")}</h3>
          {mine && (
            <button type="button" className={styles.small} onClick={onSettings}>
              <Settings2 size={16} aria-hidden /> {t("game.changeSettings")}
            </button>
          )}
        </div>
        <dl className={styles.settings}>
          {settings.map((name) => (
            <div key={name}>
              <dt>
                <Named name={name} />
              </dt>
              <dd>{value(name)}</dd>
            </div>
          ))}
          {typeof timeLimit === "number" && (
            <div>
              <dt>{t("switches.timeLimit")}</dt>
              <dd>{formatMs(timeLimit, t("wizard.numberLocale"))}</dd>
            </div>
          )}
          <div>
            <dt>{t("game.pods")}</dt>
            <dd>{peripherals + 1}</dd>
          </div>
        </dl>
      </section>

      <PodStatus path={path} />

      {resolved.issues.length > 0 && (
        <section className={styles.card} aria-label={t("game.notes")}>
          <h3>{t("game.notes")}</h3>
          <IssueList issues={resolved.issues} onSelect={setSelected} />
        </section>
      )}

      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => onMode("try")}>
          <Play size={18} aria-hidden /> {t("game.try")}
        </button>
        <button type="button" className={styles.button} onClick={mine ? () => onMode("edit") : onCopy}>
          <Pencil size={18} aria-hidden /> {mine ? t("game.edit") : copyLabel}
        </button>
      </div>

      {showBlocks && (
        <details className={styles.blocks}>
          <summary>{t("game.blocks")}</summary>
          <BlocksView graph={graph} selected={selected} onSelect={setSelected} node={selectedNode} />
        </details>
      )}
    </div>
  );
}

function BlocksView({ graph, selected, onSelect, node }: { graph: ProgramGraph; selected: string | null; onSelect: (id: string | null) => void; node: GraphNode | null }) {
  return (
    <div className={styles.graph}>
      <ProgramColumnView graph={graph} selected={selected} onSelect={onSelect} />
      {node && <BlockDetailsSheet node={node} known={new Set(graph.nodes.map((n) => n.id))} onSelect={onSelect} />}
    </div>
  );
}

/** Where the game is on the connected set (pod menu place, file on the pods); nothing without a connection. */
function PodStatus({ path }: { path: string }) {
  const { t } = useTranslation();
  const connected = usePodSession((s) => s.state === "connected");
  const files = usePodSession((s) => s.files);
  const menu = usePodSession((s) => s.list?.menu);
  const info = usePodSession((s) => s.info);
  if (!connected || podProgramFormat(info) === undefined) return null;
  const place = menu ? menu.indexOf(path) + 1 : 0;
  const onPods = files[path] !== undefined;
  const text = !onPods ? t("game.status.notOnPods") : place > 0 ? t("game.status.inMenu", { place }) : t("game.status.onPodsNotInMenu");
  return (
    <p className={styles.status} role="status">
      {text}
    </p>
  );
}

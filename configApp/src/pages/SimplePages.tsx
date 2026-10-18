import { useTranslation } from "react-i18next";
import { ListOrdered, Play, Workflow } from "lucide-react";
import { Placeholder } from "./Placeholder";

export function EditorPage() {
  const { t } = useTranslation();
  return <Placeholder icon={Workflow} intro={t("editor.intro")} phase="P4" />;
}

export function SimulatePage() {
  const { t } = useTranslation();
  return <Placeholder icon={Play} intro={t("simulate.intro")} phase="P6" />;
}

export function MenuPage() {
  const { t } = useTranslation();
  return <Placeholder icon={ListOrdered} intro={t("menu.intro")} phase="P4" />;
}

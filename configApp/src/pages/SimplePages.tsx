import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import { Placeholder } from "./Placeholder";

export function SimulatePage() {
  const { t } = useTranslation();
  return <Placeholder icon={Play} intro={t("simulate.intro")} phase="P6" />;
}

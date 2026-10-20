/** Mail texts of the identity and orgs modules (en primary, de). */
type Locale = "en" | "de";
const pick = (locale: string): Locale => (locale.startsWith("de") ? "de" : "en");

export function loginMail(locale: string, link: string, code: string, minutes: number) {
  return pick(locale) === "de"
    ? {
        subject: `ReactPod-Anmeldung: ${code}`,
        text: `Dein Anmeldecode: ${code}\n\nOder öffne diesen Link:\n${link}\n\nCode und Link gelten ${minutes} Minuten und nur einmal. Wenn du dich nicht anmelden wolltest, ignoriere diese Mail.`,
      }
    : {
        subject: `ReactPod sign-in: ${code}`,
        text: `Your sign-in code: ${code}\n\nOr open this link:\n${link}\n\nCode and link work once and expire in ${minutes} minutes. If you did not try to sign in, ignore this mail.`,
      };
}

export function inviteMail(locale: string, clubName: string, role: string, link: string, days: number) {
  return pick(locale) === "de"
    ? {
        subject: `Einladung zu ${clubName} auf ReactPod`,
        text: `Du wurdest als ${role} zu „${clubName}“ eingeladen.\n\nEinladung annehmen:\n${link}\n\nDie Einladung gilt ${days} Tage.`,
      }
    : {
        subject: `Invitation to ${clubName} on ReactPod`,
        text: `You were invited to "${clubName}" as ${role}.\n\nAccept the invitation:\n${link}\n\nThe invitation is valid for ${days} days.`,
      };
}

/** Link into the Config App (hash routing). */
export const appLink = (appUrl: string, route: string) => `${appUrl.replace(/#.*$/, "")}#${route}`;

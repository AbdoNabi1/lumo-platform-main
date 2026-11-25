import { activityTemplate, roleName } from "@/lib/staff/activity";
import type { StaffActivityItem } from "@/lib/staff/two-step";
import type { Dictionary } from "@/messages/en";

/**
 * One activity row as a sentence. The people are emails, each isolated in a `<bdi dir="auto">` so a
 * Latin address inside an Arabic sentence (or the reverse) cannot reorder the words around it; an
 * unknown person reads "Someone" (not an email, so no isolation). The actor of an event the person did
 * to themself is the same address as the subject.
 */
export function ActivitySentence({
  item,
  t,
}: {
  readonly item: StaffActivityItem;
  readonly t: Dictionary;
}) {
  const template = activityTemplate(item, t);
  const actor = item.actorEmail ?? item.subjectEmail;
  const subject = item.subjectEmail ?? item.actorEmail;
  const person = (email: string | null) =>
    email === null ? (
      t.usersActivity.someone
    ) : (
      <bdi dir="auto" className="text-foreground font-medium">
        {email}
      </bdi>
    );
  const parts = template.split(/(\{actor\}|\{subject\}|\{from\}|\{to\})/);
  return (
    <>
      {parts.map((part, index) => {
        const key = `${index}:${part}`;
        if (part === "{actor}") return <span key={key}>{person(actor)}</span>;
        if (part === "{subject}") return <span key={key}>{person(subject)}</span>;
        if (part === "{from}") return <span key={key}>{roleName(item.detail.from ?? "", t)}</span>;
        if (part === "{to}") return <span key={key}>{roleName(item.detail.to ?? "", t)}</span>;
        return <span key={key}>{part}</span>;
      })}
    </>
  );
}

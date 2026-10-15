// Family activity notifications (foyers fork): when someone adds a task, an
// appointment, a post or a note, or ticks a task off, the household's other
// members are told, in the app and by push. Never the person who acted.
//
// The texts carry the item's own words only: no household name and no person
// name, since a phone's lock screen may be seen by someone else.
import { query } from '../db';
import { createNotification, notificationLanguage, type NotificationLanguage } from './notifications';

export type Activity = 'task_created' | 'task_completed' | 'appointment_created' | 'post_created' | 'note_created';

const TITLES: Record<Activity, Record<NotificationLanguage, string>> = {
    task_created: { fr: 'Nouvelle tâche', en: 'New task', es: 'Nueva tarea', pt: 'Nova tarefa', ru: 'Новая задача', zh: '新任务' },
    task_completed: { fr: 'Tâche terminée', en: 'Task done', es: 'Tarea completada', pt: 'Tarefa concluída', ru: 'Задача выполнена', zh: '任务已完成' },
    appointment_created: { fr: 'Nouveau rendez-vous', en: 'New appointment', es: 'Nueva cita', pt: 'Novo compromisso', ru: 'Новая встреча', zh: '新预约' },
    post_created: { fr: 'Nouvelle publication', en: 'New post', es: 'Nueva publicación', pt: 'Nova publicação', ru: 'Новая публикация', zh: '新动态' },
    note_created: { fr: 'Nouveau mot de la famille', en: 'New family note', es: 'Nueva nota familiar', pt: 'Novo recado da família', ru: 'Новая записка', zh: '新留言' },
};

const KIND_LABELS: Record<'photo' | 'link', Record<NotificationLanguage, string>> = {
    photo: { fr: 'Photo', en: 'Photo', es: 'Foto', pt: 'Foto', ru: 'Фото', zh: '照片' },
    link: { fr: 'Lien', en: 'Link', es: 'Enlace', pt: 'Link', ru: 'Ссылка', zh: '链接' },
};

const ROUTES: Record<Activity, string> = {
    task_created: '/tasks',
    task_completed: '/tasks',
    appointment_created: '/calendar',
    post_created: '/posts',
    note_created: '/',
};

const LOCALES: Record<NotificationLanguage, string> = {
    fr: 'fr-FR', en: 'en-GB', es: 'es-ES', pt: 'pt-PT', ru: 'ru-RU', zh: 'zh-CN',
};

/** One line, at most `max` characters. */
const clip = (text: string, max = 140): string => {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/**
 * A stored local date-time ("2026-10-17T10:00:00", no time zone: it is the
 * family's wall-clock time) written for people: "sam. 17 oct., 10:00".
 */
export const formatWhen = (at: string, lang: NotificationLanguage, withTime: boolean): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(at);
    if (!m) return '';
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)));
    const showTime = withTime && m[4] !== undefined;
    return new Intl.DateTimeFormat(LOCALES[lang], {
        timeZone: 'UTC',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        ...(showTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(date);
};

export interface ActivityInput {
    /** Family scope (req.userId). */
    scopeId: string;
    /** Account that acted (req.actualUserId): not notified. */
    actorId: string;
    activity: Activity;
    relatedId?: string | null;
    /** The item's own words: task title, post or note text. */
    text: string;
    /** For a post without text. */
    kind?: 'photo' | 'link';
    /** Due date or start of the item, as stored. */
    when?: { at: string; withTime: boolean } | null;
}

/** The notification's title and message, in the household's language. */
export async function activityTexts(input: ActivityInput): Promise<{ title: string; message: string }> {
    const lang = await notificationLanguage(input.scopeId);
    let message = clip(input.text) || (input.kind ? KIND_LABELS[input.kind][lang] : '');
    const when = input.when?.at ? formatWhen(String(input.when.at), lang, input.when.withTime) : '';
    if (when) message = message ? `${message} · ${when}` : when;
    return { title: TITLES[input.activity][lang], message };
}

/**
 * Tell the household's other members. Best effort and never throws: called
 * after the response is sent, it must not slow down or break the request.
 */
export async function notifyActivity(input: ActivityInput): Promise<void> {
    try {
        // Nobody else in the household (one person, alone in it): nothing to say.
        const others = await query(
            `SELECT 1 FROM users WHERE (id = $1 OR family_owner_id = $1) AND id <> $2
             UNION ALL
             SELECT 1 FROM push_subscriptions WHERE user_id = $1 AND account_id IS DISTINCT FROM $2::uuid
             LIMIT 1`,
            [input.scopeId, input.actorId]
        );
        if (others.rows.length === 0) return;

        const { title, message } = await activityTexts(input);
        await createNotification({
            userId: input.scopeId,
            actorId: input.actorId,
            title: title.slice(0, 255),
            message,
            type: input.activity,
            relatedId: input.relatedId ?? null,
            url: ROUTES[input.activity],
            // Two new tasks are two notifications, not one replacing the other.
            tag: `${input.activity}:${input.relatedId ?? Date.now()}`,
        });
    } catch {
        // createNotification already logs; a lookup failure only skips the notice.
    }
}

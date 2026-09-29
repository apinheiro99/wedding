import { db } from "../db";
import { dirSize, diskFree } from "../storage";

const TZ_RE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;

/** Aggregates for the admin metrics page. All grouping happens in SQL. */
export async function metrics(tzRaw: string | null) {
  const tz = tzRaw && TZ_RE.test(tzRaw) ? tzRaw : "America/Sao_Paulo";
  const q = async (sql: string, p: unknown[] = []) => (await db().query(sql, p)).rows;
  const active = "FROM media m WHERE m.deleted_at IS NULL AND m.uploader_user_id IN (SELECT id FROM users WHERE role = 'USER')";

  const [k] = await q(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE media_kind='IMAGE')::int AS photos, count(*) FILTER (WHERE media_kind='VIDEO')::int AS videos,
      count(*) FILTER (WHERE media_kind='OTHER')::int AS others, coalesce(sum(byte_size),0)::bigint AS bytes,
      count(DISTINCT uploader_user_id)::int AS people, coalesce(sum(duration_ms) FILTER (WHERE media_kind='VIDEO'),0)::bigint AS video_ms,
      min(capture_at) AS first_capture, max(capture_at) AS last_capture,
      count(*) FILTER (WHERE metadata_json->>'latitude' IS NOT NULL)::int AS with_gps,
      count(*) FILTER (WHERE capture_at_source IN ('EXIF','CONTAINER'))::int AS with_camera_date ${active}`);
  const [u] = await q(`SELECT count(*)::int AS users, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new7 FROM users WHERE role='USER'`);
  const [dup] = await q(`SELECT count(*)::int AS n, coalesce(sum(expected_size),0)::bigint AS bytes FROM uploads WHERE state='DUPLICATE' AND user_id IN (SELECT id FROM users WHERE role='USER')`);
  const [res] = await q(`SELECT count(*)::int AS n FROM uploads WHERE state='RESTORED' AND user_id IN (SELECT id FROM users WHERE role='USER')`);
  const [dl] = await q(`SELECT count(*)::int AS n, coalesce(sum(bytes),0)::bigint AS bytes, count(DISTINCT user_id)::int AS people FROM download_events WHERE user_id IN (SELECT id FROM users WHERE role = 'USER')`);

  const byPerson = await q(`SELECT u.id, u.display_name AS name, count(*)::int AS total,
      count(*) FILTER (WHERE m.media_kind='IMAGE')::int AS photos, count(*) FILTER (WHERE m.media_kind='VIDEO')::int AS videos,
      coalesce(sum(m.byte_size),0)::bigint AS bytes
    FROM media m JOIN users u ON u.id = m.uploader_user_id WHERE m.deleted_at IS NULL AND u.role = 'USER' GROUP BY u.id ORDER BY total DESC`);

  const byFormat = await q(`SELECT upper(coalesce(nullif(substring(original_filename from '\\.([A-Za-z0-9]{1,5})$'),''),'?')) AS ext,
      count(*)::int AS n, coalesce(sum(byte_size),0)::bigint AS bytes ${active} GROUP BY 1 ORDER BY n DESC`);

  const byHour = await q(`SELECT extract(hour FROM capture_at AT TIME ZONE $1)::int AS h, count(*)::int AS n
    ${active} AND capture_at IS NOT NULL GROUP BY 1 ORDER BY 1`, [tz]);

  const byCaptureDay = await q(`SELECT to_char(sort_at AT TIME ZONE $1, 'YYYY-MM-DD') AS d, count(*)::int AS n
    ${active} GROUP BY 1 ORDER BY n DESC LIMIT 12`, [tz]);

  const uploadsPerDay = await q(`SELECT to_char(d, 'YYYY-MM-DD') AS d, coalesce(c.n,0)::int AS n, coalesce(c.bytes,0)::bigint AS bytes
    FROM generate_series((now() AT TIME ZONE $1)::date - 29, (now() AT TIME ZONE $1)::date, interval '1 day') d
    LEFT JOIN (SELECT (created_at AT TIME ZONE $1)::date AS day, count(*) AS n, sum(byte_size) AS bytes FROM media WHERE uploader_user_id IN (SELECT id FROM users WHERE role = 'USER') GROUP BY 1) c ON c.day = d::date
    ORDER BY d`, [tz]);

  const downloadsPerDay = await q(`SELECT to_char(d, 'YYYY-MM-DD') AS d, coalesce(c.n,0)::int AS n
    FROM generate_series((now() AT TIME ZONE $1)::date - 29, (now() AT TIME ZONE $1)::date, interval '1 day') d
    LEFT JOIN (SELECT (started_at AT TIME ZONE $1)::date AS day, count(*) AS n FROM download_events WHERE user_id IN (SELECT id FROM users WHERE role = 'USER') GROUP BY 1) c ON c.day = d::date
    ORDER BY d`, [tz]);

  const cameras = await q(`SELECT trim(CASE WHEN metadata_json->>'model' ILIKE (metadata_json->>'make') || '%' THEN metadata_json->>'model'
      ELSE concat_ws(' ', nullif(metadata_json->>'make',''), nullif(metadata_json->>'model','')) END) AS cam, count(*)::int AS n
    ${active} AND (metadata_json->>'make' IS NOT NULL OR metadata_json->>'model' IS NOT NULL) GROUP BY 1 ORDER BY n DESC LIMIT 8`);

  const sizes = await q(`SELECT b, count(*)::int AS n FROM (SELECT CASE
      WHEN byte_size < 1048576 THEN 0 WHEN byte_size < 5242880 THEN 1 WHEN byte_size < 20971520 THEN 2
      WHEN byte_size < 104857600 THEN 3 WHEN byte_size < 1073741824 THEN 4 ELSE 5 END AS b ${active}) s GROUP BY b ORDER BY b`);

  const resolution = await q(`SELECT CASE WHEN width*height < 2000000 THEN '< 2 MP' WHEN width*height < 8000000 THEN '2–8 MP'
      WHEN width*height < 16000000 THEN '8–16 MP' WHEN width*height < 30000000 THEN '16–30 MP' ELSE '30+ MP' END AS r, count(*)::int AS n
    ${active} AND media_kind='IMAGE' AND width IS NOT NULL GROUP BY 1`);

  const topDownloaded = await q(`SELECT u.display_name AS name, lpad(p.sequence_no::text, 2, '0') AS label, count(*)::int AS n
    FROM download_events de JOIN package_versions pv ON pv.id = de.package_version_id JOIN packages p ON p.id = pv.package_id
    JOIN users u ON u.id = p.user_id WHERE de.user_id IN (SELECT id FROM users WHERE role = 'USER') GROUP BY 1, 2 ORDER BY n DESC LIMIT 6`);

  const num = (x: unknown) => Number(x ?? 0);
  return {
    tz,
    kpis: {
      total: k.total, photos: k.photos, videos: k.videos, others: k.others, bytes: num(k.bytes), people: k.people,
      videoMs: num(k.video_ms), firstCapture: k.first_capture, lastCapture: k.last_capture, withGps: k.with_gps, withCameraDate: k.with_camera_date,
      users: u.users, newUsers7d: u.new7, duplicates: dup.n, duplicateBytes: num(dup.bytes), restored: res.n,
      downloads: dl.n, downloadBytes: num(dl.bytes), downloaders: dl.people,
      thumbsBytes: await dirSize("thumbnails"), packagesBytes: await dirSize("packages"), disk: await diskFree(),
    },
    byPerson: byPerson.map((p) => ({ ...p, bytes: num(p.bytes) })),
    byFormat: byFormat.map((f) => ({ ...f, bytes: num(f.bytes) })),
    byHour: Array.from({ length: 24 }, (_, h) => byHour.find((x) => x.h === h)?.n ?? 0),
    byCaptureDay, uploadsPerDay: uploadsPerDay.map((x) => ({ ...x, bytes: num(x.bytes) })), downloadsPerDay,
    cameras, sizes: [0, 1, 2, 3, 4, 5].map((b) => sizes.find((s) => s.b === b)?.n ?? 0),
    resolution: ["< 2 MP", "2–8 MP", "8–16 MP", "16–30 MP", "30+ MP"].map((r) => ({ r, n: resolution.find((x) => x.r === r)?.n ?? 0 })),
    topDownloaded,
  };
}

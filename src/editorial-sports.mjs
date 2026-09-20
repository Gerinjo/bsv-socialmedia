import { decodeWidgetText } from "../supabase/functions/_shared/fussball-de-widget-parser.mjs";
import { editorialResults } from "./editorial.mjs";

export function discoverTableWidget(html) {
  for (const tag of String(html).match(/<[^>]+>/g) ?? []) {
    if (!/data-type=["']table["']/.test(tag)) continue;
    const id = tag.match(/data-id=["']([0-9a-f-]{36})["']/i)?.[1];
    if (id) return id;
  }
  return null;
}
export function parseEditorialTable(html, glyphNameForCharacter) {
  const source = String(html).match(
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!source) throw new Error("Unbekanntes Tabellenformat.");
  const props = JSON.parse(source)?.props?.pageProps;
  if (props?.invalidReferrer || !Array.isArray(props?.table?.entries))
    throw new Error("Die Verbandstabelle ist nicht verfügbar.");
  const decode = (value) => decodeWidgetText(value, glyphNameForCharacter);
  return {
    competition: decode(props.competitionName),
    rows: props.table.entries.map((row) => ({
      position: decode(row.position),
      team: decode(row.teamName),
      matches: decode(row.matches),
      goals: decode(row.goalRatio),
      points: decode(row.points),
    })),
  };
}
export async function editorialSportsSnapshot({
  team,
  games,
  cutoff,
  parseFont,
  fetchImpl = fetch,
}) {
  const fetchedAt = new Date().toISOString();
  let table = null,
    sourceUrl = null,
    warning = "";
  try {
    if (!team.website_path)
      throw new Error("Keine Mannschaftsseite hinterlegt.");
    const sourcePage = new URL(
      team.website_path.replace(/^\/+/, "").replace(/\/?$/, "/"),
      "https://bsvnordstern.de/",
    );
    if (sourcePage.origin !== "https://bsvnordstern.de")
      throw new Error("Ungültige Mannschaftsseite.");
    const get = async (url) => {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(12000),
        redirect: "error",
        headers: { referer: sourcePage.href },
      });
      if (!response.ok)
        throw new Error(
          `Sportdaten nicht erreichbar (HTTP ${response.status}).`,
        );
      return response;
    };
    const widget = discoverTableWidget(
      await (await get(sourcePage.href)).text(),
    );
    if (!widget)
      throw new Error(
        "Für diese Mannschaft ist keine Verbandstabelle hinterlegt.",
      );
    sourceUrl = `https://next.fussball.de/widget/table/${widget}`;
    const html = await (await get(sourceUrl)).text();
    const source = html.match(
      /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];
    const props = source ? JSON.parse(source)?.props?.pageProps : null;
    if (!props || props.invalidReferrer)
      throw new Error("Die Verbandstabelle ist nicht verfügbar.");
    const font = props.obfuscatedFont
      ? parseFont(
          await (
            await get(
              `https://www.fussball.de/export.fontface/-/format/ttf/id/${encodeURIComponent(props.obfuscatedFont)}/type/font`,
            )
          ).arrayBuffer(),
        )
      : null;
    table = parseEditorialTable(
      html,
      (character) => font?.charToGlyph(character)?.name,
    );
  } catch (error) {
    warning = error.message;
  }
  const results = editorialResults(games, team.id, cutoff);
  const tableText = table?.rows.length
    ? `${table.competition}\nPlatz | Mannschaft | Spiele | Tore | Punkte\n${table.rows.map((row) => [row.position, row.team, row.matches, row.goals, row.points].join(" | ")).join("\n")}`
    : "Keine Verbandstabelle verfügbar.";
  const body = `${team.name}\n\nTABELLE · Abruf ${new Date(fetchedAt).toLocaleDateString("de-DE")}\n${tableText}\n\nERGEBNISSE · bis ${cutoff}\n${results || "Keine abgeschlossenen Ergebnisse im gespeicherten Datenbestand."}`;
  return {
    body,
    snapshot: {
      fetchedAt,
      sourceUrl,
      table,
      results,
      cutoff,
      warning,
      resultsSource:
        "social_games · letzte zehn gespeicherte abgeschlossene Spiele",
    },
  };
}

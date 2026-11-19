import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { registerReportFonts } from "./fonts.js";
import type { ReportBuild } from "./model.js";

const ink = "#1A1A17";
const mute = "#66655E";
const dim = "#A09F97";
const line = "#E1DFD7";
const line2 = "#ECEAE4";
const panel = "#F7F6F2";
const accent = "#E8A87C";
const good = "#E1F1E8";
const goodInk = "#1D5A3E";
const warn = "#FBEBD3";
const warnInk = "#8A4B00";
const noteBg = "#FDF7F1";

const styles = StyleSheet.create({
  page: { paddingTop: 58, paddingRight: 61, paddingBottom: 64, paddingLeft: 61, fontFamily: "Inter", fontSize: 9.6, color: ink, lineHeight: 1.45 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 0.75, borderBottomColor: line, paddingBottom: 7, marginBottom: 14 },
  headFirm: { fontFamily: "Inter", fontWeight: 700, fontSize: 9 },
  headMeta: { fontSize: 7.5, color: mute },
  mono: { fontFamily: "Mono", fontSize: 8 },
  label: { fontFamily: "Mono", fontSize: 7, color: mute, textTransform: "uppercase", letterSpacing: 0.6 },
  letterhead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 1.5, borderBottomColor: accent, paddingBottom: 10, marginBottom: 22 },
  firm: { fontFamily: "Inter", fontWeight: 700, fontSize: 12 },
  firmSub: { fontSize: 7.5, color: mute, marginTop: 2 },
  letterMeta: { fontSize: 7.5, color: mute, textAlign: "right" },
  letter: { fontSize: 10, lineHeight: 1.55, marginBottom: 10 },
  re: { fontFamily: "Inter", fontWeight: 600, fontSize: 10, marginTop: 8, marginBottom: 12 },
  callout: { flexDirection: "row", borderWidth: 0.75, borderColor: line, borderRadius: 6, marginBottom: 12 },
  calloutCell: { flex: 1, padding: 10, borderRightWidth: 0.75, borderRightColor: line },
  calloutValue: { fontFamily: "Inter", fontWeight: 600, fontSize: 14, marginTop: 4 },
  unit: { fontFamily: "Inter", fontWeight: 400, fontSize: 8, color: mute },
  sign: { marginTop: 16 },
  signName: { fontFamily: "Inter", fontWeight: 600, marginTop: 22 },
  muted: { color: mute, fontSize: 8, marginTop: 16 },
  kicker: { fontFamily: "Mono", fontSize: 7, color: mute, textTransform: "uppercase", letterSpacing: 0.8 },
  h1: { fontFamily: "Inter", fontWeight: 600, fontSize: 21, lineHeight: 1.15, marginTop: 4, marginBottom: 6 },
  h2: { fontFamily: "Inter", fontWeight: 600, fontSize: 11.5, marginBottom: 8 },
  h3: { fontFamily: "Inter", fontWeight: 600, fontSize: 10, marginTop: 10, marginBottom: 4 },
  sub: { color: mute, fontSize: 9, lineHeight: 1.3, marginBottom: 8 },
  stats: { flexDirection: "row", borderTopWidth: 0.75, borderTopColor: line, borderBottomWidth: 0.75, borderBottomColor: line, marginTop: 10, marginBottom: 12 },
  stat: { flex: 1, paddingTop: 8, paddingBottom: 8, paddingRight: 8 },
  statBorder: { borderLeftWidth: 0.75, borderLeftColor: line, paddingLeft: 10 },
  statValue: { fontFamily: "Inter", fontWeight: 500, fontSize: 16, marginTop: 3 },
  statMono: { fontFamily: "Mono", fontSize: 11, marginTop: 6 },
  statNote: { fontSize: 7.5, color: mute, marginTop: 2 },
  th: { fontFamily: "Mono", fontSize: 6.5, color: mute, textTransform: "uppercase" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: line2, paddingTop: 4, paddingBottom: 4, alignItems: "center" },
  cellInv: { width: 68, fontFamily: "Mono", fontSize: 8 },
  cellFind: { flex: 1, paddingRight: 6 },
  cellTitle: { fontSize: 8.5 },
  cellDetail: { fontSize: 7.5, color: mute, marginTop: 1 },
  cellMoney: { width: 136, textAlign: "right" },
  cellDispute: { width: 70, alignItems: "flex-end" },
  strike: { color: dim, textDecoration: "line-through", fontSize: 8 },
  correct: { fontSize: 8.5 },
  pill: { backgroundColor: good, borderRadius: 4, paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6 },
  pillWarn: { backgroundColor: warn },
  pillText: { color: goodInk, fontFamily: "Inter", fontWeight: 600, fontSize: 8 },
  pillWarnText: { color: warnInk, fontFamily: "Inter", fontWeight: 600, fontSize: 8 },
  total: { flexDirection: "row", borderTopWidth: 0.75, borderTopColor: ink, paddingTop: 6, marginTop: 2 },
  totalText: { fontFamily: "Inter", fontWeight: 600, fontSize: 8.5 },
  foot: { fontSize: 7.5, color: mute, marginTop: 6 },
  step: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: line2, paddingTop: 3, paddingBottom: 3 },
  stepNo: { width: 14, height: 14, borderWidth: 0.75, borderColor: line, borderRadius: 7, textAlign: "center", fontFamily: "Mono", fontSize: 7, color: mute, marginRight: 8 },
  stepText: { flex: 1, fontSize: 8.5 },
  card: { borderWidth: 0.75, borderColor: line, borderRadius: 6, marginBottom: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", backgroundColor: panel, borderBottomWidth: 0.75, borderBottomColor: line, paddingTop: 7, paddingBottom: 7, paddingLeft: 10, paddingRight: 10 },
  cardNo: { fontFamily: "Mono", fontSize: 7.5, color: mute, width: 18 },
  cardInv: { fontFamily: "Mono", fontSize: 8, marginRight: 8 },
  cardTitle: { flex: 1, fontFamily: "Inter", fontWeight: 600, fontSize: 10 },
  cardBody: { flexDirection: "row", padding: 10 },
  cardCol: { flex: 1, paddingRight: 8 },
  cardColRight: { flex: 1.05 },
  body: { fontSize: 8.6, lineHeight: 1.45 },
  ref: { fontSize: 7.6, color: mute, marginTop: 6 },
  money: { flexDirection: "row", borderWidth: 0.5, borderColor: line, borderRadius: 4, marginBottom: 6 },
  moneyCell: { flex: 1, padding: 5 },
  moneyBorder: { borderLeftWidth: 0.5, borderLeftColor: line },
  moneyValue: { fontFamily: "Inter", fontWeight: 600, fontSize: 10, marginTop: 1 },
  moneyStrike: { color: dim, textDecoration: "line-through", fontFamily: "Inter", fontWeight: 400, fontSize: 10, marginTop: 1 },
  calcRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 1 },
  calcLabel: { fontSize: 8, flex: 1, paddingRight: 6 },
  calcValue: { fontSize: 8, textAlign: "right" },
  calcRule: { borderTopWidth: 0.75, borderTopColor: ink, marginTop: 3, paddingTop: 3 },
  tag: { fontFamily: "Mono", fontSize: 6.5, color: mute, backgroundColor: panel, borderWidth: 0.5, borderColor: line, borderRadius: 3, paddingTop: 1, paddingBottom: 1, paddingLeft: 4, paddingRight: 4 },
  notes: { fontSize: 7, color: mute, borderTopWidth: 0.5, borderTopColor: line, paddingTop: 6, marginTop: 4 },
  scopeRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: line2, paddingTop: 3, paddingBottom: 3, alignItems: "center" },
  note: { borderLeftWidth: 2, borderLeftColor: accent, backgroundColor: noteBg, padding: 8, marginTop: 8, marginBottom: 8 },
});

function Head({ model }: { model: ReportBuild }) {
  return (
    <View style={styles.head} fixed>
      <Text style={styles.headFirm}>{model.firmName.toUpperCase()}</Text>
      <Text style={styles.headMeta}>
        {model.customerName} · <Text style={styles.mono}>{model.reportNumber}</Text>
      </Text>
    </View>
  );
}

function Pill({ amount, amber }: { amount: string; amber: boolean }) {
  return (
    <View style={amber ? [styles.pill, styles.pillWarn] : styles.pill}>
      <Text style={amber ? styles.pillWarnText : styles.pillText}>{amount}</Text>
    </View>
  );
}

function Front({ model }: { model: ReportBuild }) {
  const headline = model.letter[0] ?? "";
  const middle = model.letter[1] ?? "";
  const close = model.letter[2] ?? "";
  return (
    <Document title={`${model.firmName} ${model.reportNumber}`} author={model.firmName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.letterhead}>
          <View>
            <Text style={styles.firm}>{model.firmName.toUpperCase()}</Text>
            <Text style={styles.firmSub}>Demurrage and detention audit and recovery</Text>
          </View>
          <View>
            <Text style={styles.letterMeta}>{model.cityState}</Text>
            <Text style={styles.letterMeta}>{model.replyTo}</Text>
          </View>
        </View>
        <Text style={styles.letter}>{model.issuedLong}</Text>
        <Text style={styles.letter}>{model.attention}</Text>
        <Text style={styles.re}>
          Re: Demurrage and detention audit · report <Text style={styles.mono}>{model.reportNumber}</Text>
        </Text>
        <Text style={styles.letter}>{headline}</Text>
        <View style={styles.callout}>
          {model.callout.map((item, index) => (
            <View key={item.label} style={index === model.callout.length - 1 ? [styles.calloutCell, { borderRightWidth: 0 }] : styles.calloutCell}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.calloutValue}>
                {item.value} <Text style={styles.unit}>{item.unit}</Text>
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.letter}>{middle}</Text>
        <Text style={styles.letter}>{close}</Text>
        <View style={styles.sign}>
          <Text style={styles.letter}>Sincerely,</Text>
          <Text style={styles.signName}>{model.signerName}</Text>
          <Text style={styles.muted}>{model.signerTitle}, {model.firmName}</Text>
        </View>
        <Text style={styles.muted}>{model.enclosure}</Text>
      </Page>
      <Page size="LETTER" style={styles.page}>
        <Head model={model} />
        <Text style={styles.kicker}>Demurrage and detention audit</Text>
        <Text style={styles.h1}>{model.customerName}</Text>
        <Text style={styles.sub}>{model.summarySub}</Text>
        <View style={styles.stats}>
          {model.stats.map((stat, index) => (
            <View key={stat.label} style={index === 0 ? styles.stat : [styles.stat, styles.statBorder]}>
              <Text style={styles.label}>{stat.label}</Text>
              <Text style={stat.mono ? styles.statMono : styles.statValue}>
                {stat.value} {stat.unit === "" ? "" : <Text style={styles.unit}>{stat.unit}</Text>}
              </Text>
              <Text style={styles.statNote}>{stat.note}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.h2}>Findings by invoice</Text>
        <View style={styles.row}>
          <View style={styles.cellInv}><Text style={styles.th}>Invoice</Text></View>
          <View style={{ flex: 1 }}><Text style={styles.th}>Finding</Text></View>
          <View style={styles.cellMoney}><Text style={[styles.th, { textAlign: "right" }]}>Billed → correct</Text></View>
          <View style={styles.cellDispute}><Text style={[styles.th, { textAlign: "right" }]}>In dispute</Text></View>
        </View>
        {model.rows.map((row) => (
          <View key={row.invoice} style={styles.row}>
            <Text style={styles.cellInv}>{row.invoice}</Text>
            <View style={styles.cellFind}>
              <Text style={styles.cellTitle}>{row.title}</Text>
              <Text style={styles.cellDetail}>{row.detail}</Text>
            </View>
            <View style={styles.cellMoney}>
              <Text style={styles.strike}>{row.billed}</Text>
              <Text style={styles.correct}>{row.correct}</Text>
            </View>
            <View style={styles.cellDispute}>
              <Pill amount={row.dispute} amber={row.amber} />
            </View>
          </View>
        ))}
        {model.total === null ? <Text style={styles.sub}>No findings.</Text> : (
          <View style={styles.total}>
            <View style={styles.cellInv} />
            <Text style={[styles.totalText, { flex: 1 }]}>Total</Text>
            <View style={styles.cellMoney}>
              <Text style={styles.totalText}>{model.total.billed} → {model.total.correct}</Text>
            </View>
            <View style={styles.cellDispute}>
              <Text style={styles.totalText}>{model.total.dispute}</Text>
            </View>
          </View>
        )}
        {model.amberNote === null ? null : <Text style={styles.foot}>{model.amberNote}</Text>}
        <Text style={[styles.h2, { marginTop: 12 }]}>Next steps</Text>
        {model.steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <Text style={styles.stepNo}>{index + 1}</Text>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </Page>
      <Page size="LETTER" style={styles.page}>
        <Head model={model} />
        <Text style={styles.h2}>Findings in detail</Text>
        {model.cards.map((card) => (
          <View key={card.number} style={styles.card} wrap={false}>
            <View style={styles.cardHead}>
              <Text style={styles.cardNo}>{card.number}</Text>
              <Text style={styles.cardInv}>{card.invoice}</Text>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Pill amount={card.amount} amber={card.amber} />
            </View>
            <View style={styles.cardBody}>
              <View style={styles.cardCol}>
                <Text style={styles.body}>{card.body}</Text>
                <Text style={styles.ref}>{card.exhibitRef}</Text>
              </View>
              <View style={styles.cardColRight}>
                <View style={styles.money}>
                  <View style={styles.moneyCell}>
                    <Text style={styles.label}>Billed</Text>
                    <Text style={styles.moneyStrike}>{card.billed}</Text>
                  </View>
                  <View style={[styles.moneyCell, styles.moneyBorder]}>
                    <Text style={styles.label}>Correct</Text>
                    <Text style={styles.moneyValue}>{card.correct}</Text>
                  </View>
                  <View style={[styles.moneyCell, styles.moneyBorder]}>
                    <Text style={styles.label}>In dispute</Text>
                    <Text style={styles.moneyValue}>{card.dispute}</Text>
                  </View>
                </View>
                {card.calc.map((line, index) => (
                  <View key={`${card.number}-${line.label}`} style={index === card.calc.length - 1 ? [styles.calcRow, styles.calcRule] : styles.calcRow}>
                    <Text style={styles.calcLabel}>{line.label}</Text>
                    {line.tag ? <Text style={styles.tag}>{line.value}</Text> : <Text style={styles.calcValue}>{line.value}</Text>}
                  </View>
                ))}
              </View>
            </View>
          </View>
        ))}
        <Text style={styles.notes}>
          {model.footnotes.map((note) => `${note.n}. ${note.text}`).join("    ")}
        </Text>
      </Page>
    </Document>
  );
}

function Scope({ model }: { model: ReportBuild }) {
  return (
    <Document title={`${model.firmName} ${model.reportNumber}`} author={model.firmName}>
      <Page size="LETTER" style={styles.page}>
        <Head model={model} />
        <Text style={styles.h2}>{model.scopeTitle}</Text>
        <View style={styles.row}>
          <Text style={[styles.th, { width: 80 }]}>Invoice</Text>
          <Text style={[styles.th, { width: 80 }]}>Date</Text>
          <Text style={[styles.th, { width: 70, textAlign: "right" }]}>Billed</Text>
          <Text style={[styles.th, { flex: 1, paddingLeft: 12 }]}>Result</Text>
        </View>
        {model.scope.map((row) => (
          <View key={row.invoice} style={styles.scopeRow}>
            <Text style={[styles.mono, { width: 80 }]}>{row.invoice}</Text>
            <Text style={{ width: 80, fontSize: 8.5 }}>{row.date}</Text>
            <Text style={{ width: 70, textAlign: "right", fontSize: 8.5 }}>{row.billed}</Text>
            {row.tag ? <Text style={[styles.tag, { marginLeft: 12 }]}>{row.result}</Text> : <Text style={{ flex: 1, paddingLeft: 12, fontSize: 8.5 }}>{row.result}</Text>}
          </View>
        ))}
        <View style={styles.note}>
          <Text style={styles.body}>
            <Text style={{ fontFamily: "Inter", fontWeight: 700 }}>{model.scopeNoteTitle} </Text>
            {model.scopeNote}
          </Text>
        </View>
        <Text style={styles.h3}>{model.methodTitle}</Text>
        <Text style={styles.body}>{model.method}</Text>
        <Text style={styles.h3}>{model.limitsTitle}</Text>
        <Text style={styles.body}>{model.limits}</Text>
      </Page>
    </Document>
  );
}

export async function renderFront(model: ReportBuild): Promise<Uint8Array> {
  registerReportFonts();
  const buffer = await renderToBuffer(<Front model={model} />);
  return new Uint8Array(buffer);
}

export async function renderScope(model: ReportBuild): Promise<Uint8Array> {
  registerReportFonts();
  const buffer = await renderToBuffer(<Scope model={model} />);
  return new Uint8Array(buffer);
}

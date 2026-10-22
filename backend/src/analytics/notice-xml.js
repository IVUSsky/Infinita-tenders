// Разчита eForms/UBL XML на едно TED обявление до структура с позиции, резултати и участници.

// Extract top-level blocks of <tag>...</tag>, handling same-tag nesting.
export function blocks(s, tag) {
  const openRe = new RegExp('<' + tag + '(?:[^>A-Za-z][^>]*)?>', 'g');
  const scanRe = new RegExp('<' + tag + '(?:[^>A-Za-z][^>]*)?>|</' + tag + '>', 'g');
  const res = [];
  let m;
  while ((m = openRe.exec(s))) {
    const afterOpen = openRe.lastIndex;
    scanRe.lastIndex = afterOpen;
    let depth = 1, mm, ok = false;
    while ((mm = scanRe.exec(s))) {
      if (mm[0][1] === '/') {
        depth--;
        if (depth === 0) { res.push(s.slice(afterOpen, mm.index)); openRe.lastIndex = scanRe.lastIndex; ok = true; break; }
      } else depth++;
    }
    if (!ok) break;
  }
  return res;
}

const one = (s, re) => { const m = s.match(re); return m ? m[1] : ''; };
const many = (s, re) => [...s.matchAll(re)].map(m => m[1]);
const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function parseNotice(xml) {
  const o = {};
  o.id = one(xml, /<efbc:NoticePublicationID[^>]*>([^<]+)</);
  o.pubDate = one(xml, /<efbc:PublicationDate>([^<]+)</).slice(0, 10);
  o.subtype = one(xml, /<efac:NoticeSubType>\s*<cbc:SubTypeCode[^>]*>([^<]+)</);
  o.issueDate = one(xml, /<cbc:IssueDate>([^<]+)</).slice(0, 10);
  o.folder = one(xml, /<cbc:ContractFolderID>([^<]+)</);
  o.procId = one(xml, /<cbc:ID schemeName="InternalID">([^<]+)</);

  o.orgs = {};
  for (const b of blocks(xml, 'efac:Organization')) {
    const id = one(b, /<cbc:ID schemeName="organization">([^<]+)</);
    if (!id) continue;
    o.orgs[id] = {
      name: dec(one(b, /<cac:PartyName>\s*<cbc:Name[^>]*>([^<]*)</)),
      companyId: one(b, /<cac:PartyLegalEntity>\s*<cbc:CompanyID[^>]*>([^<]*)</),
      city: one(b, /<cbc:CityName>([^<]*)</),
      country: one(b, /<cbc:IdentificationCode listName="country">([^<]*)</),
      size: one(b, /<efbc:CompanySizeCode[^>]*>([^<]*)</),
    };
  }

  const cp = blocks(xml, 'cac:ContractingParty')[0] || '';
  const buyerRef = one(cp, /<cbc:ID schemeName="organization">([^<]+)</);
  const bo = o.orgs[buyerRef] || {};
  o.buyer = bo.name || dec(one(xml, /<cac:PartyName>\s*<cbc:Name[^>]*>([^<]*)</));
  o.buyerId = bo.companyId || '';
  o.buyerCity = bo.city || '';

  const lotBlocks = blocks(xml, 'cac:ProcurementProjectLot');
  let stripped = xml;
  for (const lb of lotBlocks) stripped = stripped.replace(lb, '');
  const pp = blocks(stripped, 'cac:ProcurementProject')[0] || '';
  o.title = dec(one(pp, /<cbc:Name[^>]*>([\s\S]*?)<\/cbc:Name>/));
  o.descProc = dec(one(pp, /<cbc:Description[^>]*>([\s\S]*?)<\/cbc:Description>/));
  o.cpvMain = one(pp, /<cac:MainCommodityClassification>\s*<cbc:ItemClassificationCode[^>]*>([^<]+)</);
  o.estTotal = one(stripped, /<cbc:EstimatedOverallContractAmount[^>]*>([\d.]+)</);
  o.estCur = one(stripped, /<cbc:EstimatedOverallContractAmount currencyID="([A-Z]+)"/);
  o.procType = one(xml, /<cbc:ProcedureCode[^>]*>([^<]+)</);

  o.lots = lotBlocks.map(b => {
    const p = blocks(b, 'cac:ProcurementProject')[0] || '';
    return {
      lotId: one(b, /<cbc:ID schemeName="Lot">([^<]+)</),
      name: dec(one(p, /<cbc:Name[^>]*>([\s\S]*?)<\/cbc:Name>/)),
      desc: dec(one(p, /<cbc:Description[^>]*>([\s\S]*?)<\/cbc:Description>/)),
      cpv: one(p, /<cac:MainCommodityClassification>\s*<cbc:ItemClassificationCode[^>]*>([^<]+)</),
      cpvAdd: many(p, /<cac:AdditionalCommodityClassification>\s*<cbc:ItemClassificationCode[^>]*>([^<]+)</g),
      qty: one(p, /<cbc:EstimatedOverallContractQuantity[^>]*>([\d.]+)</),
      est: one(b, /<cbc:EstimatedOverallContractAmount[^>]*>([\d.]+)</),
      estCur: one(b, /<cbc:EstimatedOverallContractAmount currencyID="([A-Z]+)"/),
      deadline: one(b, /<cbc:EndDate>([^<]+)</).slice(0, 10),
    };
  });

  const nr = blocks(xml, 'efac:NoticeResult')[0] || '';
  o.totalAwarded = one(nr, /<cbc:TotalAmount[^>]*>([\d.]+)</);
  o.totalAwardedCur = one(nr, /<cbc:TotalAmount currencyID="([A-Z]+)"/);

  o.results = blocks(nr, 'efac:LotResult').map(b => ({
    resultId: one(b, /<cbc:ID schemeName="result">([^<]+)</),
    higher: one(b, /<cbc:HigherTenderAmount[^>]*>([\d.]+)</),
    lower: one(b, /<cbc:LowerTenderAmount[^>]*>([\d.]+)</),
    cur: one(b, /<cbc:HigherTenderAmount currencyID="([A-Z]+)"/),
    status: one(b, /<cbc:TenderResultCode[^>]*>([^<]+)</),
    reason: one(b, /<efbc:DecisionReasonCode[^>]*>([^<]+)</),
    tenders: many(b, /<cbc:ID schemeName="tender">([^<]+)</g),
    contracts: many(b, /<cbc:ID schemeName="contract">([^<]+)</g),
    lotId: one(b, /<cbc:ID schemeName="Lot">([^<]+)</),
    nTenders: (() => {
      const st = blocks(b, 'efac:ReceivedSubmissionsStatistics').find(x => />tenders</.test(x));
      return st ? one(st, /<efbc:StatisticsNumeric>(\d+)</) : '';
    })(),
  }));

  o.tenders = blocks(nr, 'efac:LotTender')
    .filter(b => /LegalMonetaryTotal|tendering-party/.test(b))
    .map(b => ({
      tenderId: one(b, /<cbc:ID schemeName="tender">([^<]+)</),
      payable: one(b, /<cbc:PayableAmount[^>]*>([\d.]+)</),
      cur: one(b, /<cbc:PayableAmount currencyID="([A-Z]+)"/),
      rank: one(b, /<cbc:RankCode>([^<]+)</),
      tpa: one(b, /<cbc:ID schemeName="tendering-party">([^<]+)</),
      lotId: one(b, /<cbc:ID schemeName="Lot">([^<]+)</),
      ref: dec(one(b, /<efac:TenderReference>\s*<cbc:ID[^>]*>([\s\S]*?)<\/cbc:ID>/)),
    }));

  o.parties = {};
  for (const b of blocks(nr, 'efac:TenderingParty').filter(x => /Tenderer/.test(x))) {
    const id = one(b, /<cbc:ID schemeName="tendering-party">([^<]+)</);
    o.parties[id] = blocks(b, 'efac:Tenderer')
      .map(t => one(t, /<cbc:ID schemeName="organization">([^<]+)</)).filter(Boolean);
  }

  o.contracts = blocks(nr, 'efac:SettledContract')
    .filter(b => /IssueDate|cbc:Title/.test(b))
    .map(b => ({
      conId: one(b, /<cbc:ID schemeName="contract">([^<]+)</),
      date: one(b, /<cbc:IssueDate>([^<]+)</).slice(0, 10),
      title: dec(one(b, /<cbc:Title[^>]*>([\s\S]*?)<\/cbc:Title>/)),
      tenders: many(b, /<cbc:ID schemeName="tender">([^<]+)</g),
    }));

  return o;
}

/**
 * Build Tally Sales voucher XML from paid transactions (server-side).
 */
const db = require('../config/db');

function escapeXml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function ledgerNameForPayment(method) {
    const m = String(method || '');
    if (/^cash$/i.test(m)) return 'Cash-in-Hand';
    return 'Razorpay Bank A/c';
}

function buildTallyXml(rows) {
    let xml = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
`;

    for (const tx of rows) {
        const iso = tx.date instanceof Date ? tx.date.toISOString() : String(tx.date);
        const cleanDate = iso.split('T')[0].replace(/-/g, '');
        const party = tx.customer_name === 'Walk-in Customer' ? 'Cash' : tx.customer_name;
        const subtotal = Number(tx.subtotal).toFixed(2);
        const cgst = Number(tx.cgst).toFixed(2);
        const sgst = Number(tx.sgst).toFixed(2);
        const total = Number(tx.total).toFixed(2);
        const bank = ledgerNameForPayment(tx.payment_method);

        xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="AccountingVoucher">
            <DATE>${cleanDate}</DATE>
            <VOUCHERNUMBER>${escapeXml(tx.invoice_no)}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME>
            <EFFECTIVEDATE>${cleanDate}</EFFECTIVEDATE>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sales Account</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${subtotal}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>CGST @ 9%</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${cgst}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>SGST @ 9%</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${sgst}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(bank)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${total}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
`;
    }

    xml += `      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
    return xml;
}

async function fetchPaidSales({ from, to, unsyncedOnly = false }) {
    const params = [from, to];
    let sql = `
        SELECT id, invoice_no, date, customer_name, subtotal, cgst, sgst, total, payment_method
        FROM transactions
        WHERE COALESCE(payment_status, 'paid') = 'paid'
          AND date::date >= $1::date
          AND date::date <= $2::date`;
    if (unsyncedOnly) {
        sql += ' AND tally_exported_at IS NULL';
    }
    sql += ' ORDER BY date ASC';
    const result = await db.query(sql, params);
    return result.rows;
}

/**
 * Generate XML, optionally mark as exported and/or POST to Tally HTTP.
 */
async function exportTallyPeriod({ from, to, unsyncedOnly = false, markExported = true, pushRemote = true }) {
    const rows = await fetchPaidSales({ from, to, unsyncedOnly });
    const xml = buildTallyXml(rows);

    let remoteRef = null;
    let status = 'generated';
    let error = null;

    const tallyUrl = process.env.TALLY_HTTP_URL && String(process.env.TALLY_HTTP_URL).trim();
    if (pushRemote && tallyUrl && rows.length) {
        try {
            const res = await fetch(tallyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/xml',
                    ...(process.env.TALLY_HTTP_TOKEN
                        ? { Authorization: `Bearer ${process.env.TALLY_HTTP_TOKEN.trim()}` }
                        : {})
                },
                body: xml
            });
            const text = await res.text().catch(() => '');
            if (!res.ok) {
                status = 'push_failed';
                error = text.slice(0, 500) || `HTTP ${res.status}`;
            } else {
                status = 'pushed';
                remoteRef = text.slice(0, 200) || `HTTP ${res.status}`;
            }
        } catch (err) {
            status = 'push_failed';
            error = err.message;
        }
    } else if (!tallyUrl) {
        status = 'generated';
    }

    const insert = await db.query(
        `INSERT INTO ledger_exports (provider, period_from, period_to, voucher_count, status, payload, remote_ref, error)
         VALUES ('tally', $1, $2, $3, $4, $5, $6, $7)
         RETURNING id, status, voucher_count, created_at`,
        [from, to, rows.length, status, xml, remoteRef, error]
    );

    if (markExported && rows.length && (status === 'generated' || status === 'pushed')) {
        const ids = rows.map((r) => r.id);
        await db.query(
            `UPDATE transactions SET tally_exported_at = NOW()
             WHERE id = ANY($1::varchar[])`,
            [ids]
        );
    }

    return {
        exportId: insert.rows[0].id,
        status,
        voucherCount: rows.length,
        from,
        to,
        xml,
        error,
        remoteRef,
        tallyConfigured: Boolean(tallyUrl)
    };
}

function defaultYesterdayRange() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.toISOString().slice(0, 10);
    return { from: y, to: y };
}

function defaultTodayRange() {
    const y = new Date().toISOString().slice(0, 10);
    return { from: y, to: y };
}

module.exports = {
    buildTallyXml,
    fetchPaidSales,
    exportTallyPeriod,
    defaultYesterdayRange,
    defaultTodayRange
};

import { jsPDF } from 'jspdf';

const COLORS = {
  ink: [24, 32, 42],
  muted: [104, 116, 135],
  brown: [156, 102, 68],
  lightBrown: [244, 238, 232],
  line: [224, 218, 210],
  blue: [37, 99, 235],
  red: [180, 35, 24]
};

export const formatReceiptMoney = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(Number(amount) || 0);

export const formatReceiptDate = (value) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
};

const getValue = (record, snakeKey, camelKey, fallback = '') => record?.[snakeKey] ?? record?.[camelKey] ?? fallback;

export const getReceiptItems = (order) => (order?.order_items ?? order?.items ?? []).map((item) => ({
  name: item.product_name || item.productName || item.products?.name || item.name || 'Appliance',
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.price_at_time ?? item.priceAtTime ?? item.price ?? 0),
  total: Number(item.price_at_time ?? item.priceAtTime ?? item.price ?? 0) * Number(item.quantity || 0)
}));

export const getReceiptStatusLabel = (order) => {
  const status = String(getValue(order, 'status', 'status', 'Pending')).trim().toLowerCase();
  const fulfillmentMethod = getValue(order, 'fulfillment_method', 'fulfillmentMethod');
  if (status.includes('cancel')) return 'Cancelled';
  if (status.includes('complete') || status.includes('deliver') || status.includes('picked')) {
    return fulfillmentMethod === 'DOOR_PICKUP' ? 'Picked & Paid' : 'Delivered & Paid';
  }
  if (status.includes('confirm') || status.includes('process')) return 'Confirmed';
  return 'Pending';
};

const getFulfillmentLabel = (order) => getValue(order, 'fulfillment_method', 'fulfillmentMethod') === 'DOOR_PICKUP'
  ? 'Door pickup'
  : 'Delivery is offered';

const getReceiptFilename = (order) => {
  const orderId = String(order?.id || 'order').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `WenAppliances-receipt-${orderId}.pdf`;
};

const setText = (doc, color) => doc.setTextColor(...color);
const setFill = (doc, color) => doc.setFillColor(...color);
const setDraw = (doc, color) => doc.setDrawColor(...color);

const drawWatermark = (doc) => {
  setText(doc, [239, 231, 224]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('WENAPPLIANCES - CONFIDENTIAL', 30, 174, { angle: 28 });
};

const drawLogo = (doc, x = 18, y = 18) => {
  setFill(doc, COLORS.brown);
  doc.roundedRect(x, y, 18, 18, 3, 3, 'F');
  setText(doc, [255, 255, 255]);
  doc.setFont('times', 'bold');
  doc.setFontSize(16);
  doc.text('W', x + 9, y + 13, { align: 'center' });

  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Wen', x + 23, y + 11);
  setText(doc, COLORS.brown);
  doc.setFont('helvetica', 'normal');
  doc.text('Appliances', x + 48, y + 11);
};

const drawFooter = (doc) => {
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    setDraw(doc, COLORS.line);
    doc.setLineWidth(0.25);
    doc.line(18, pageHeight - 19, pageWidth - 18, pageHeight - 19);
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('WenAppliances - Thank you for your purchase.', 18, pageHeight - 11);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - 18, pageHeight - 11, { align: 'right' });
  }
};

export const createReceiptPdf = (order) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  const customerName = getValue(order, 'customer_name', 'customerName', 'Not provided');
  const customerEmail = getValue(order, 'customer_email', 'customerEmail', 'Not provided');
  const customerPhone = getValue(order, 'customer_phone', 'customerPhone', 'Not provided');
  const createdAt = getValue(order, 'created_at', 'createdAt');
  const orderId = getValue(order, 'id', 'id', 'Unavailable');
  const statusLabel = getReceiptStatusLabel(order);
  const items = getReceiptItems(order);
  const totalAmount = Number(getValue(order, 'total_amount', 'totalAmount', 0));
  const cancellationReason = getValue(order, 'cancellation_reason', 'cancellationReason');

  let y = 18;
  const ensureSpace = (height) => {
    if (y + height <= pageHeight - 27) return;
    doc.addPage();
    drawWatermark(doc);
    y = 24;
  };

  drawWatermark(doc);
  drawLogo(doc);

  setText(doc, COLORS.brown);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('OFFICIAL PURCHASE RECEIPT', margin, 51);
  setText(doc, COLORS.ink);
  doc.setFontSize(23);
  doc.text('WenAppliances Receipt', margin, 62);

  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Order reference: ${orderId}`, margin, 70);
  doc.text(`Issued: ${formatReceiptDate(createdAt)}`, margin, 76);

  const statusColor = statusLabel === 'Cancelled' ? COLORS.red : statusLabel === 'Pending' ? [119, 81, 18] : COLORS.blue;
  const pillWidth = Math.max(28, doc.getTextWidth(statusLabel) + 12);
  setFill(doc, statusLabel === 'Cancelled' ? [254, 242, 242] : statusLabel === 'Pending' ? [250, 244, 226] : [239, 246, 255]);
  doc.roundedRect(pageWidth - margin - pillWidth, 51, pillWidth, 10, 5, 5, 'F');
  setText(doc, statusColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(statusLabel, pageWidth - margin - pillWidth / 2, 57.5, { align: 'center' });

  y = 89;
  const boxGap = 6;
  const boxWidth = (contentWidth - boxGap) / 2;
  const boxHeight = 40;
  const drawInfoBox = (x, title, lines) => {
    setFill(doc, [250, 248, 245]);
    setDraw(doc, COLORS.line);
    doc.roundedRect(x, y, boxWidth, boxHeight, 3, 3, 'FD');
    setText(doc, COLORS.brown);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(title.toUpperCase(), x + 6, y + 8);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    let lineY = y + 16;
    lines.forEach((line) => {
      const wrapped = doc.splitTextToSize(String(line || 'Not provided'), boxWidth - 12).slice(0, 2);
      doc.text(wrapped, x + 6, lineY);
      lineY += wrapped.length * 4.2 + 2;
    });
  };

  drawInfoBox(margin, 'Customer', [customerName, customerEmail, customerPhone]);
  drawInfoBox(margin + boxWidth + boxGap, 'Fulfillment', [
    getFulfillmentLabel(order),
    getValue(order, 'payment_method', 'paymentMethod', 'Not provided'),
    getValue(order, 'delivery_address', 'deliveryAddress', 'Pickup arrangements by phone or email')
  ]);

  y += boxHeight + 14;
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Purchase details', margin, y);
  y += 8;

  const columns = {
    item: margin + 5,
    quantity: margin + contentWidth * 0.62,
    unit: margin + contentWidth * 0.75,
    total: pageWidth - margin - 5
  };
  const tableHeader = () => {
    setFill(doc, COLORS.lightBrown);
    doc.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('ITEM', columns.item, y + 6.5);
    doc.text('QTY', columns.quantity, y + 6.5, { align: 'center' });
    doc.text('UNIT', columns.unit, y + 6.5, { align: 'right' });
    doc.text('TOTAL', columns.total, y + 6.5, { align: 'right' });
    y += 13;
  };

  tableHeader();
  items.forEach((item) => {
    const itemLines = doc.splitTextToSize(item.name, contentWidth * 0.49);
    const rowHeight = Math.max(9, itemLines.length * 4.2 + 3);
    ensureSpace(rowHeight + 3);
    if (y === 24) tableHeader();
    setDraw(doc, COLORS.line);
    doc.setLineWidth(0.2);
    doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(itemLines, columns.item, y + 4.5);
    doc.text(String(item.quantity), columns.quantity, y + 4.5, { align: 'center' });
    doc.text(formatReceiptMoney(item.unitPrice), columns.unit, y + 4.5, { align: 'right' });
    doc.text(formatReceiptMoney(item.total), columns.total, y + 4.5, { align: 'right' });
    y += rowHeight + 2;
  });

  if (!items.length) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('No line items found.', columns.item, y + 4);
    y += 12;
  }

  ensureSpace(34);
  y += 5;
  setFill(doc, [248, 250, 252]);
  setDraw(doc, COLORS.line);
  doc.roundedRect(pageWidth - margin - 78, y, 78, 25, 3, 3, 'FD');
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('TOTAL RECORDED', pageWidth - margin - 72, y + 8);
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(formatReceiptMoney(totalAmount), pageWidth - margin - 6, y + 19, { align: 'right' });
  y += 38;

  if (cancellationReason) {
    ensureSpace(20);
    setFill(doc, [254, 242, 242]);
    setDraw(doc, [252, 165, 165]);
    doc.roundedRect(margin, y, contentWidth, 16, 3, 3, 'FD');
    setText(doc, COLORS.red);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Cancellation reason', margin + 6, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(cancellationReason, contentWidth - 45).slice(0, 1), margin + 40, y + 6);
    y += 23;
  }

  ensureSpace(24);
  setText(doc, COLORS.brown);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Thank you for choosing WenAppliances.', margin, y);
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Keep this receipt for your records.', margin, y + 7);

  drawFooter(doc);
  return doc;
};

export const downloadReceiptPdf = (order) => {
  const doc = createReceiptPdf(order);
  doc.save(getReceiptFilename(order));
};

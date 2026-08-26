import { jsPDF } from 'jspdf';

const COLORS = {
  ink: [24, 32, 42],
  navy: [25, 39, 52],
  brown: [156, 102, 68],
  gold: [202, 145, 83],
  cream: [249, 246, 241],
  softBrown: [244, 235, 226],
  line: [221, 214, 205],
  muted: [103, 115, 133],
  green: [21, 128, 88],
  red: [180, 35, 24]
};

let logoDataUrlPromise;

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

const getPaymentLabel = (order) => getValue(order, 'payment_method', 'paymentMethod', 'Cash on collection/delivery');

const getReceiptFilename = (order) => {
  const orderId = String(order?.id || 'order').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `WenAppliances-receipt-${orderId}.pdf`;
};

const setText = (doc, color) => doc.setTextColor(...color);
const setFill = (doc, color) => doc.setFillColor(...color);
const setDraw = (doc, color) => doc.setDrawColor(...color);

const drawFallbackLogo = (doc, x, y, size) => {
  setFill(doc, COLORS.brown);
  doc.roundedRect(x, y, size, size, 3, 3, 'F');
  setText(doc, [255, 255, 255]);
  doc.setFont('times', 'bold');
  doc.setFontSize(size * 0.65);
  doc.text('W', x + size / 2, y + size * 0.72, { align: 'center' });
};

const drawLogoImage = (doc, logoDataUrl, x, y, size) => {
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', x, y, size, size, 'wen-logo', 'FAST');
      return;
    } catch {
      // Fall back to the vector mark if the browser cannot decode the supplied image.
    }
  }
  drawFallbackLogo(doc, x, y, size);
};

const drawWatermark = (doc, logoDataUrl) => {
  if (!logoDataUrl || typeof doc.setGState !== 'function' || typeof doc.GState !== 'function') return;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const size = Math.min(pageWidth * 0.84, pageHeight * 0.62);
  const x = (pageWidth - size) / 2;
  const y = (pageHeight - size) / 2 - 2;

  doc.saveGraphicsState?.();
  doc.setGState(new doc.GState({ opacity: 0.1 }));
  try {
    doc.addImage(logoDataUrl, 'PNG', x, y, size, size, 'wen-watermark', 'FAST');
  } finally {
    doc.restoreGraphicsState?.();
  }
};

const drawFooter = (doc, logoDataUrl) => {
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    setDraw(doc, COLORS.line);
    doc.setLineWidth(0.25);
    doc.line(16, pageHeight - 22, pageWidth - 16, pageHeight - 22);
    drawLogoImage(doc, logoDataUrl, 16, pageHeight - 18, 9);
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('WenAppliances - 3-month warranty - Delivery offered - Old stock haul-away', 28, pageHeight - 12);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - 16, pageHeight - 12, { align: 'right' });
  }
};

const drawInfoCard = (doc, x, y, width, height, title, lines) => {
  setFill(doc, [255, 255, 255]);
  setDraw(doc, COLORS.line);
  doc.roundedRect(x, y, width, height, 3, 3, 'FD');
  setFill(doc, COLORS.softBrown);
  doc.roundedRect(x, y, width, 10, 3, 3, 'F');
  doc.rect(x, y + 7, width, 3, 'F');
  setText(doc, COLORS.brown);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(title.toUpperCase(), x + 6, y + 6.5);
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let lineY = y + 17;
  lines.forEach((line) => {
    const wrapped = doc.splitTextToSize(String(line || 'Not provided'), width - 12).slice(0, 2);
    doc.text(wrapped, x + 6, lineY);
    lineY += wrapped.length * 3.8 + 2.3;
  });
};

const getCleanLogoDataUrl = async () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch('/wen-icon.png')
      .then((response) => {
        if (!response.ok) throw new Error('WenAppliances logo could not be loaded');
        return response.blob();
      })
      .then((blob) => new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
          const canvas = document.createElement('canvas');
          canvas.width = 240;
          canvas.height = 240;
          const context = canvas.getContext('2d');
          if (!context) {
            resolve(null);
            return;
          }

          context.drawImage(
            image,
            Math.max(0, (image.naturalWidth - cropSize) / 2),
            Math.max(0, (image.naturalHeight - cropSize) / 2),
            cropSize,
            cropSize,
            0,
            0,
            240,
            240
          );

          const pixels = context.getImageData(0, 0, 240, 240);
          for (let index = 0; index < pixels.data.length; index += 4) {
            const red = pixels.data[index];
            const green = pixels.data[index + 1];
            const blue = pixels.data[index + 2];
            const brightness = (red + green + blue) / 3;
            const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 20;
            if (neutral && brightness > 125) pixels.data[index + 3] = 0;
          }
          context.putImageData(pixels, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('WenAppliances logo could not be decoded'));
        };
        image.src = objectUrl;
      }))
      .catch(() => null);
  }
  return logoDataUrlPromise;
};

export const createReceiptPdf = (order, logoDataUrl = null) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const customerName = getValue(order, 'customer_name', 'customerName', 'Not provided');
  const customerEmail = getValue(order, 'customer_email', 'customerEmail', 'Not provided');
  const customerPhone = getValue(order, 'customer_phone', 'customerPhone', 'Not provided');
  const createdAt = getValue(order, 'created_at', 'createdAt', order?.date);
  const orderId = getValue(order, 'id', 'id', 'Unavailable');
  const statusLabel = getReceiptStatusLabel(order);
  const items = getReceiptItems(order);
  const totalAmount = Number(getValue(order, 'total_amount', 'totalAmount', order?.total || 0));
  const paidAmount = Number(getValue(order, 'paid_amount', 'paidAmount', totalAmount));
  const itemsSubtotal = items.reduce((sum, item) => sum + item.total, 0);
  const negotiatedDiscount = Math.max(0, itemsSubtotal - totalAmount);
  const cancellationReason = getValue(order, 'cancellation_reason', 'cancellationReason');
  const boxGap = 5;
  const boxWidth = (contentWidth - boxGap) / 2;
  let y = 17;

  const drawPageDecor = () => {
    setFill(doc, COLORS.cream);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
    drawWatermark(doc, logoDataUrl);
  };

  const ensureSpace = (height) => {
    if (y + height <= pageHeight - 30) return;
    doc.addPage();
    drawPageDecor();
    y = 22;
  };

  // Warm paper background and oversized branded watermark.
  drawPageDecor();

  // A light, polished header keeps the receipt easy to read when printed.
  setFill(doc, [255, 255, 255]);
  setDraw(doc, COLORS.line);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, 14, contentWidth, 43, 4, 4, 'FD');
  setFill(doc, COLORS.brown);
  doc.roundedRect(margin, 14, 5, 43, 2, 2, 'F');
  setFill(doc, COLORS.cream);
  doc.roundedRect(margin + 10, 21, 22, 22, 4, 4, 'F');
  drawLogoImage(doc, logoDataUrl, margin + 11, 22, 20);

  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('WenAppliances', margin + 38, 27);
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('OFFICIAL PURCHASE RECEIPT', margin + 38, 34);
  doc.text(`Order ref: ${orderId}`, margin + 38, 41);
  doc.text(`Issued: ${formatReceiptDate(createdAt)}`, margin + 38, 48);

  const statusColor = statusLabel === 'Cancelled' ? COLORS.red : statusLabel === 'Pending' ? COLORS.gold : COLORS.green;
  const statusFill = statusLabel === 'Cancelled' ? [255, 235, 235] : statusLabel === 'Pending' ? [255, 247, 218] : [226, 247, 238];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const pillWidth = Math.max(32, doc.getTextWidth(statusLabel) + 13);
  setFill(doc, statusFill);
  doc.roundedRect(pageWidth - margin - pillWidth - 7, 23, pillWidth, 11, 5.5, 5.5, 'F');
  setText(doc, statusColor);
  doc.text(statusLabel, pageWidth - margin - pillWidth / 2 - 7, 30, { align: 'center' });

  y = 67;
  drawInfoCard(doc, margin, y, boxWidth, 43, 'Customer details', [
    `Name: ${customerName}`,
    `Email: ${customerEmail}`,
    `Phone: ${customerPhone}`
  ]);
  drawInfoCard(doc, margin + boxWidth + boxGap, y, boxWidth, 43, 'Fulfillment & payment', [
    `Method: ${getFulfillmentLabel(order)}`,
    `Paid via: ${getPaymentLabel(order)}`,
    `Address: ${getValue(order, 'delivery_address', 'deliveryAddress', 'Pickup arrangements by phone or email')}`
  ]);

  y += 54;
  setText(doc, COLORS.brown);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('ORDER SUMMARY', margin, y);
  y += 7;

  const columns = {
    item: margin + 5,
    quantity: margin + contentWidth * 0.60,
    unit: margin + contentWidth * 0.76,
    total: pageWidth - margin - 5
  };
  const tableHeader = () => {
    setFill(doc, COLORS.brown);
    doc.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
    setText(doc, [255, 255, 255]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('ITEM', columns.item, y + 6.5);
    doc.text('QTY', columns.quantity, y + 6.5, { align: 'center' });
    doc.text('UNIT PRICE', columns.unit, y + 6.5, { align: 'right' });
    doc.text('TOTAL', columns.total, y + 6.5, { align: 'right' });
    y += 13;
  };

  tableHeader();
  items.forEach((item, itemIndex) => {
    const itemLines = doc.splitTextToSize(item.name, contentWidth * 0.46);
    const rowHeight = Math.max(9, itemLines.length * 4.2 + 3);
    ensureSpace(rowHeight + 3);
    if (y === 22) tableHeader();
    if (itemIndex % 2 === 0) {
      setFill(doc, [255, 252, 248]);
      doc.rect(margin, y - 2, contentWidth, rowHeight + 2, 'F');
    }
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(itemLines, columns.item, y + 4.5);
    doc.text(String(item.quantity), columns.quantity, y + 4.5, { align: 'center' });
    doc.text(formatReceiptMoney(item.unitPrice), columns.unit, y + 4.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(formatReceiptMoney(item.total), columns.total, y + 4.5, { align: 'right' });
    setDraw(doc, COLORS.line);
    doc.setLineWidth(0.2);
    doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
    y += rowHeight + 2;
  });

  if (!items.length) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('No line items found.', columns.item, y + 4);
    y += 12;
  }

  ensureSpace(44);
  y += 6;
  const summaryX = pageWidth - margin - 84;
  const summaryHeight = negotiatedDiscount > 0 ? 44 : 36;
  setFill(doc, COLORS.navy);
  doc.roundedRect(summaryX, y, 84, summaryHeight, 3, 3, 'F');
  setText(doc, [211, 221, 230]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('SUBTOTAL', summaryX + 7, y + 9);
  setText(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.text(formatReceiptMoney(itemsSubtotal || totalAmount), summaryX + 77, y + 9, { align: 'right' });
  let paidRowY = y + 17;
  if (negotiatedDiscount > 0) {
    setText(doc, [255, 210, 145]);
    doc.setFont('helvetica', 'normal');
    doc.text('NEGOTIATED DISCOUNT', summaryX + 7, y + 17);
    doc.setFont('helvetica', 'bold');
    doc.text(`-${formatReceiptMoney(negotiatedDiscount)}`, summaryX + 77, y + 17, { align: 'right' });
    paidRowY = y + 25;
  }
  setText(doc, [211, 221, 230]);
  doc.setFont('helvetica', 'normal');
  doc.text('AMOUNT PAID', summaryX + 7, paidRowY);
  setText(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.text(formatReceiptMoney(paidAmount), summaryX + 77, paidRowY, { align: 'right' });
  setDraw(doc, [100, 121, 137]);
  doc.line(summaryX + 7, paidRowY + 4, summaryX + 77, paidRowY + 4);
  setText(doc, [255, 210, 145]);
  doc.setFontSize(12);
  doc.text(formatReceiptMoney(paidAmount), summaryX + 77, y + summaryHeight - 6, { align: 'right' });
  setText(doc, [211, 221, 230]);
  doc.setFontSize(7);
  doc.text('TOTAL PAID', summaryX + 7, y + summaryHeight - 6.5);
  y += summaryHeight + 11;

  if (cancellationReason) {
    ensureSpace(21);
    setFill(doc, [255, 239, 239]);
    setDraw(doc, [252, 165, 165]);
    doc.roundedRect(margin, y, contentWidth, 17, 3, 3, 'FD');
    setText(doc, COLORS.red);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('CANCELLATION REASON', margin + 6, y + 6.5);
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(cancellationReason, contentWidth - 57).slice(0, 1), margin + 56, y + 6.5);
    y += 24;
  }

  ensureSpace(31);
  setFill(doc, COLORS.softBrown);
  doc.roundedRect(margin, y, contentWidth, 25, 3, 3, 'F');
  setText(doc, COLORS.brown);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Thank you for choosing WenAppliances.', margin + 8, y + 9);
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Keep this receipt for your records. Questions? wgnganga@gmail.com  •  +1 404 858 9764', margin + 8, y + 16);
  drawLogoImage(doc, logoDataUrl, pageWidth - margin - 24, y + 3, 18);

  drawFooter(doc, logoDataUrl);
  return doc;
};

export const downloadReceiptPdf = async (order) => {
  const logoDataUrl = await getCleanLogoDataUrl();
  const doc = createReceiptPdf(order, logoDataUrl);
  doc.save(getReceiptFilename(order));
};

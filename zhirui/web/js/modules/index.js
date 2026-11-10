// 模組清單：側邊選單與路由都從這裡產生
import home from './home.js';
import retail from './retail.js';
import pricing from './pricing.js';
import quotes from './quotes.js';
import sales from './sales.js';
import orders from './orders.js';
import drawing from './drawing.js';
import faxes from './faxes.js';
import labels from './labels.js';
import mail from './mail.js';
import purchase from './purchase.js';
import stock from './stock.js';
import receivables from './receivables.js';
import payables from './payables.js';
import invoices from './invoices.js';
import checksOut from './checks_out.js';
import checksIn from './checks_in.js';
import money from './money.js';
import reports from './reports.js';
import master from './master.js';
import settings from './settings.js';

// 門市銷售、出貨銷貨、採購進貨三個最常用的排在最上面（不分組）
export const MODULES = [home, retail, sales, purchase, pricing, quotes, orders, faxes, drawing, stock, labels, receivables, mail, payables, invoices, checksOut, checksIn, money, reports, master, settings];

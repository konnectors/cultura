const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const formatDate = require('date-fns/format')

const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very usefull for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})

const baseUrl = 'https://www.cultura.com'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching orders URLs')
  const ordersURLs = await getOrdersURLs()
  log('info', 'Successfully fetched orders URLs')

  log('info', 'Fetching bills')
  const bills = await getBills(ordersURLs)
  log('info', 'Successfully fetched bills')

  log('info', 'Saving bills to Cozy')
  await saveBills(bills, fields.folderPath, {
    identifiers: ['cultura']
  })
  log('info', 'Saved bills to Cozy')
}

function authenticate(login, password) {
  return signin({
    url: `${baseUrl}/customer/account/login`,
    formSelector: '#login-form',
    formData: { 'login[username]': login, 'login[password]': password },
    validate: (statusCode, $) => {
      if ($(`.disconnect`).length === 1) {
        return true
      } else {
        const error = $('.account-login .error-msg').text()
        log('error', error)
        return false
      }
    }
  })
}

async function getOrdersURLs() {
  const $ = await request(`${baseUrl}/sales/order/history`)
  const urls = $('#my-orders-table .action-link')
    .map((i, el) => $(el).attr('href'))
    .get()

  return urls
}

async function getBills(ordersURLs) {
  const bills = await Promise.all(ordersURLs.map(url => getBill(url)))

  return bills
}

async function getBill(orderURL) {
  const $ = await request(orderURL)
  const date = getDate($)
  const invoiceNumber = getInvoiceNumber($)
  const { amount, currency } = getAmountAndCurrency($)

  const bill = {
    vendor: 'Cultura',
    date,
    amount,
    currency,
    fileurl: getFileUrl($),
    filename: getFilename(date, amount, invoiceNumber)
  }

  return bill
}

function getDate($) {
  const $el = $('.title-buttons li:first-child')
  const rawDate = $el.text().trim()
  const [day, monthStr, year] = rawDate
    .substring('Date de la commande '.length, rawDate.indexOf(','))
    .split(' ')

  const months = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre'
  ]

  return new Date(year, months.indexOf(monthStr), day)
}

function getAmountAndCurrency($) {
  const $el = $('.total-row')
  const rawAmount = $el.text().trim()
  const currency = rawAmount.substr(-1)
  const amount = parseFloat(
    rawAmount
      .substring('Total : '.length, rawAmount.length - 2)
      .replace(',', '.')
  )

  return { amount, currency }
}

function getInvoiceNumber($) {
  const $el = $('.title-buttons li:first-child')
  const rawInvoiceNumber = $el.text().trim()
  const [, invoiceNumber] = rawInvoiceNumber.split(', n°')

  return invoiceNumber
}

function getFileUrl($) {
  const $el = $('#my-orders-table .table-link')
  const url = $el.attr('href')

  return url
}

function getFilename(date, amount, invoiceNumber) {
  const dateISO = formatDate(date, 'YYYY-MM-DD')
  const amountStr = String(amount).replace('.', '-')

  return `${dateISO}_${amountStr}_${invoiceNumber}.pdf`
}

import { useMemo } from 'react'
import { gql } from '@apollo/client'
import useSWR from 'swr'
import { ethers } from 'ethers'

import {
  USD_DECIMALS,
  CHART_PERIODS,
  formatAmount
} from '../Helpers'
import {
  chainlinkClient
} from './common'

const BigNumber = ethers.BigNumber

// Ethereum network, Chainlink Aggregator contracts
const FEED_ID_MAP = {
  "BTC_USD": "0xF04B8cf2CB29cbE2FcFD0d6CdcD64A3d96b0e944",
  "ETH_USD": "0x9359fec0A7a4180d3313208eb9F5fE335eb80F36",
  "GT_USD": "0x948c46AE6010551a7F8aBbf5D0186a44D7D47Af3",
  "BNB_USD": "0xCA4e0946138DCF6f3f12c6D44b77f12fbB5B308E",
  "DAI_USD": "0xA9B2e4E3282a39A6f76Cd7B60f3B41D071D71902"
};
const timezoneOffset = -(new Date()).getTimezoneOffset() * 60

function fillGaps(prices, periodSeconds) {
  if (prices.length < 2) {
    return prices
  }

  const newPrices = [prices[0]]
  let prevTime = prices[0].time
  for (let i = 1; i < prices.length; i++) {
    const { time, open } = prices[i]
    if (prevTime) {
      let j = (time - prevTime) / periodSeconds - 1
      while (j > 0) {
        newPrices.push({
          time: time - j * periodSeconds,
          open,
          close: open,
          high: open * 1.0003,
          low: open * 0.9996
        })
        j--
      }
    }

    prevTime = time
    newPrices.push(prices[i])
  }

  return newPrices
}

async function getChartPricesFromStats(chainId, symbol, period) {
  if (['WBTC', 'WETH', 'WAVAX', 'WGT'].includes(symbol)) {
    symbol = symbol.substr(1)
  }
  const hostname = 'https://stats.gmx.io/'
  // const hostname = 'http://localhost:3113/'
  const timeDiff = CHART_PERIODS[period] * 3000
  const from = Math.floor(Date.now() / 1000 - timeDiff)
  const url = `${hostname}api/candles/${symbol}?preferableChainId=${'43114'}&period=${period}&from=${from}&preferableSource=fast`
  const TIMEOUT = 5000
  const res = await new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error(`request timeout ${url}`)), TIMEOUT)
    fetch(url).then(resolve).catch(reject)
  })
  if (!res.ok) {
    throw new Error(`request failed ${res.status} ${res.statusText}`)
  }
  const json = await res.json()
  let prices = json?.prices
  if (!prices || prices.length < 10) {
    throw new Error(`not enough prices data: ${prices?.length}`)
  }

  const OBSOLETE_THRESHOLD = Date.now() / 1000 - (60 * 30) // 30 min ago
  const updatedAt = json?.updatedAt || 0
  if (updatedAt < OBSOLETE_THRESHOLD) {
    throw new Error(
      'chart data is obsolete, last price record at ' + new Date(updatedAt * 1000).toISOString()
      + ' now: ' + new Date().toISOString())
  }

  prices = prices.map(({ t, o: open, c: close, h: high, l: low}) => ({
    time: t + timezoneOffset, open, close, high, low
  }))
  return prices
}

function getCandlesFromPrices(prices, period) {
  const periodTime = CHART_PERIODS[period]

  if (prices.length < 2) {
    return []
  }

  const candles = []
  const first = prices[0]
  let prevTsGroup = Math.floor(first[0] / periodTime) * periodTime
  let prevPrice = first[1]
  let o = prevPrice
  let h = prevPrice
  let l = prevPrice
  let c = prevPrice
  for (let i = 1; i < prices.length; i++) {
    const [ts, price] = prices[i]
    const tsGroup = Math.floor(ts / periodTime) * periodTime
    if (prevTsGroup !== tsGroup) {
      candles.push({ t: prevTsGroup + timezoneOffset, o, h, l, c })
      o = c
      h = Math.max(o, c)
      l = Math.min(o, c)
    }
    c = price
    h = Math.max(h, price)
    l = Math.min(l, price)
    prevTsGroup = tsGroup
  }

  return candles.map(({ t: time, o: open, c: close, h: high, l: low}) => ({
    time, open, close, high, low
  }))
}

function getChainlinkChartPricesFromGraph(tokenSymbol, period) {
  if (['WBTC', 'WETH', 'WGT'].includes(tokenSymbol)) {
    tokenSymbol = tokenSymbol.substr(1)
  }
  const marketName = tokenSymbol + '_USD'
  const feedId = FEED_ID_MAP[marketName];
  if (!feedId) {
    throw new Error(`undefined marketName ${feedId}`)
  }

  const PER_CHUNK = 1000;
  const CHUNKS_TOTAL = 6;
  const requests = [];
  for (let i = 0; i < CHUNKS_TOTAL; i++) {
    const query = gql(`{
      chainlinkPrices(
        first: ${PER_CHUNK},
        skip: ${i * PER_CHUNK},
        orderBy: timestamp,
        orderDirection: desc,
        where: {token: "${feedId}"}
      ) {
        timestamp,
        value
      }
    }`)
    requests.push(chainlinkClient.query({query}))
  }

  return Promise.all(requests).then(chunks => {
    let prices = [];
    const uniqTs = new Set();
    chunks.forEach(chunk => {
      chunk.data.chainlinkPrices.forEach(item => {
        if (uniqTs.has(item.timestamp)) {
          return;
        }

        uniqTs.add(item.timestamp)
        prices.push([
            item.timestamp,
            Number(item.value) / 1e8
        ]);
      })
    });

    prices.sort(([timeA], [timeB]) => timeA - timeB)
    prices = getCandlesFromPrices(
      prices,
      period
    )
    return prices
  }).catch(err => {
    console.error(err);
  })
}

export function useChartPrices(chainId, symbol, isStable, period, currentAveragePrice) {
  const swrKey = (!isStable && symbol) ? ['getChartCandles', chainId, symbol, period] : null
  let { data: prices, mutate: updatePrices } = useSWR(swrKey, {
    fetcher: async (...args) => {
      try {
        return await getChainlinkChartPricesFromGraph(symbol, period)
        // return await getChartPricesFromStats(chainId, symbol, period)
      } catch (ex) {
        console.warn(ex)
        console.warn('Switching to graph chainlink data')
        // try {
        //   return await getChainlinkChartPricesFromGraph(symbol, period)
        // } catch (ex2) {
        //   console.warn('getChainlinkChartPricesFromGraph failed')
        //   console.warn(ex2)
        //   return []
        // }
      }
    },
    dedupingInterval: 60000,
    focusThrottleInterval: 60000 * 10
  })

  const currentAveragePriceString = currentAveragePrice && currentAveragePrice.toString()
  const retPrices = useMemo(() => {
    if (isStable) {
      return getStablePriceData(period)
    }

    if (!prices) {
      return []
    }

    let _prices = [...prices]
    if (currentAveragePriceString && prices.length) {
      _prices = appendCurrentAveragePrice(_prices, BigNumber.from(currentAveragePriceString), period)
    }

    return fillGaps(_prices, CHART_PERIODS[period])
  }, [prices, isStable, currentAveragePriceString, period])

  return [retPrices, updatePrices]
}

function appendCurrentAveragePrice(prices, currentAveragePrice, period) {
  const periodSeconds = CHART_PERIODS[period]
  const currentCandleTime = Math.floor(Date.now() / 1000 / periodSeconds) * periodSeconds + timezoneOffset
  const last = prices[prices.length - 1]
  const averagePriceValue = parseFloat(formatAmount(currentAveragePrice, USD_DECIMALS, 2))
  if (currentCandleTime === last.time) {
    last.close = averagePriceValue
    last.high = Math.max(last.high, averagePriceValue)
    last.low = Math.max(last.low, averagePriceValue)
    return prices
  } else {
    const newCandle = {
      time: currentCandleTime,
      open: last.close,
      close: averagePriceValue,
      high: averagePriceValue,
      low: averagePriceValue
    }
    return [...prices, newCandle]
  }
}

function getStablePriceData(period) {
  const periodSeconds = CHART_PERIODS[period]
  const now = Math.floor(Date.now() / 1000 / periodSeconds) * periodSeconds;
  let priceData = []
  for (let i = 100; i > 0; i--) {
    priceData.push({
      time: now - i * periodSeconds,
      open: 1,
      close: 1,
      high: 1,
      low: 1
    })
  }
  return priceData
}


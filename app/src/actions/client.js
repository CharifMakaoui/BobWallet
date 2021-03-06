import store from '../store';
import { observe, action } from 'mobx';
import { DEFAULT_ROUTE, DEFAULT_TAB, VERSION } from '../config';

import Client from '../shufflelink/network';
import Bitcoin from '../shufflelink/bitcoin_bcoin';
const bitcoinUtilsCore = new Bitcoin({
  CHAIN: 'tBTC',
  bcoin: window.bcoin,
});
const bitcoinUtilsCash = new Bitcoin({
  CHAIN: 'tBCH',
  bcoin: window.bcash,
});
const bitcoinUtils = {
  tBTC: bitcoinUtilsCore,
  tBCH: bitcoinUtilsCash,
};

class ActionsClient {
  constructor() {
    observe(store, 'loaded', () => {
      const {
        settings: { aliceSeed, bobSeed },
      } = store;
      if (aliceSeed && bobSeed) {
        this.initAlice({});
      }
    });

    setInterval(() => this.getRoundInfo(), 1000);
    // this.autoJoin();
  }
  clearAlice() {
    this.disconnect();
    store.bobClient = null;
    store.route = DEFAULT_ROUTE;
    store.routeTab = DEFAULT_TAB;
    store.clear();
    this.refreshAddresses();
  }

  // autoJoin() {
  //   clearTimeout(this.tautoJoin);
  //   const {
  //     bobClient,
  //     settings: { simpleMode },
  //   } = store;
  //   if (bobClient && simpleMode) {
  //     // store.bobClient.setAutoJoin(9999);
  //     store.bobClient.connect();
  //   }
  //   this.tautoJoin = setTimeout(() => {
  //     this.autoJoin();
  //   }, 3000);
  // }

  initAlice({
    chain = store.settings.chain,
    aliceSeed = store.settings.aliceSeed,
    bobSeed = store.settings.bobSeed,
    aliceIndex = store.settings.aliceIndex,
    bobIndex = store.settings.bobIndex,
    changeIndex = store.settings.changeIndex,
  }) {
    const {
      settings: { serverAddress, simpleMode },
    } = store;

    store.bobClient = new Client({
      chain,
      version: VERSION,
      // DISABLE_UTXO_FETCH: true,
      bitcoinUtils: bitcoinUtils[chain],
      aliceSeed,
      bobSeed,
      aliceIndex,
      bobIndex,
      changeIndex,
      serverAddress,
      callbackBalance: res => {
        try {
          const { address, balance, needed, error } = res;
          if (error) throw new Error(error);
          store.addressBalances.set(address, balance);
          // if (needed && address === store.roundAddresses.fromAddress) {
          //   store.neededFunds = needed;
          // }
          if (needed) {
            store.neededFunds = needed;
          }
          store.saveAddressBalances();
        } catch (err) {
          console.log('ERROR', err);
        }
      },
      callbackStateChange: () => this.getRoundInfo(),
      callbackError: () => this.getRoundInfo(),
      callbackRoundComplete: action(tx => {
        // console.log('Completed round', tx);
        const {
          error,
          to,
          from,
          change,
          out,
          left,
          fees,
          serialized,
          bobs,
          txid,
          date,
        } = tx;
        const {
          bobClient: { aliceIndex, bobIndex, changeIndex },
          settings: {
            successfulRounds,
            failedRounds,
            privateBalance,
            totalFees,
          },
        } = store;
        store.settings.aliceIndex = aliceIndex;
        store.settings.bobIndex = bobIndex;
        store.settings.changeIndex =
          changeIndex === undefined ? aliceIndex + 1 : changeIndex;
        if (tx && !tx.error) {
          // Update balances on our estimates
          const { addressBalances } = store;
          const toAmount = (addressBalances.get(to) || 0) + out;
          store.addressBalances.set(from, 0); // Sent balance
          store.addressBalances.set(
            change,
            (addressBalances.get(change) || 0) + left
          );
          store.addressBalances.set(to, toAmount);
          store.saveAddressBalances();

          store.settings.successfulRounds = successfulRounds + 1;
          store.settings.privateBalance = privateBalance + toAmount;
          store.settings.totalFees = totalFees + fees;

          store.lastRawTx = {
            tx: serialized,
            txid,
          };
        } else {
          store.settings.failedRounds = failedRounds + 1;
        }
        store.save();
        this.getRoundInfo();
        this.refreshAddresses();

        store.completedRounds.unshift({
          error,
          to,
          from,
          change,
          out,
          fees,
          left,
          bobs,
          txid,
          date,
        });
        store.saveCompletedRounds();
      }),
    });
    store.settings.aliceSeed = store.bobClient.aliceSeed;
    store.settings.bobSeed = store.bobClient.bobSeed;
    store.settings.aliceIndex = store.bobClient.aliceIndex;
    store.settings.bobIndex = store.bobClient.bobIndex;
    store.settings.changeIndex = store.bobClient.changeIndex;
    store.settings.chain = chain;
    store.settings.ticker = chain;
    store.save();
    this.refreshAddresses();
    this.getRoundInfo();

    if (simpleMode) {
      store.bobClient.connect();
    }
  }
  refreshAddresses() {
    const { bobClient } = store;
    if (bobClient) {
      store.roundAddresses = bobClient.getAddresses();
    } else {
      return {};
    }
  }
  toggleAutoChange() {
    store.settings.disableAutoChange = !store.settings.disableAutoChange;
    store.save();
  }

  updateServer(address) {
    // store.settings.serverAddress = address.replace(/(http:\/\/.*)\//i, '$1');
    store.settings.serverAddress = address;
    store.save();
    if (store.bobClient) {
      store.bobClient.setServer(address);
    }
  }
  // join(value) {
  //   // store.bobClient.setAutoJoin(value);
  //   // if (value === 0) {
  //   //   store.bobClient.unjoin();
  //   // }
  //   // this.getRoundInfo();
  // }
  isValidSeed(seed) {
    return bitcoinUtils[store.settings.chain].isMnemonicValid(seed);
  }
  isValidXPub(key) {
    return bitcoinUtils[store.settings.chain].isXPubValid(key);
  }
  isInvalid(address) {
    return bitcoinUtils[store.settings.chain].isInvalid(address);
  }
  newMnemonic() {
    return bitcoinUtils[store.settings.chain].newMnemonic();
  }
  updateKeyIndexes({
    aliceIndex = store.settings.aliceIndex,
    bobIndex = store.settings.bobIndex,
    changeIndex = store.settings.changeIndex,
  }) {
    const {
      bobClient,
      settings: { disableAutoChange },
    } = store;
    if (bobClient) {
      bobClient.updateKeyIndexes({
        aliceIndex,
        bobIndex,
        changeIndex: disableAutoChange ? changeIndex : undefined,
      });
      store.settings.changeIndex = bobClient.changeIndex;
      store.settings.bobIndex = bobClient.bobIndex;
      store.settings.aliceIndex = bobClient.aliceIndex;
      store.save();
      this.refreshAddresses();
    }
  }
  toggleConnect() {
    const { bobClient } = store;
    if (bobClient) {
      if (bobClient.isConnected || bobClient.isConnecting) {
        bobClient.disconnect();
      } else {
        bobClient.connect();
      }
      this.getRoundInfo();
    }
  }
  disconnect() {
    const { bobClient } = store;
    if (bobClient) {
      bobClient.disconnect();
    }
  }
  getRoundInfo() {
    const { bobClient } = store;
    store.roundInfo = bobClient ? bobClient.getRoundInfo() : {};
  }
}

export default new ActionsClient();

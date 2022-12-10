//#region Imports
// Stable
import { encodeHdPublicKey, HdKeyNetwork, secp256k1 } from "@bitauth/libauth";

// Unstable?
import {
  binToHex,
  CashAddressNetworkPrefix,
  deriveHdPublicNode,
  decodePrivateKeyWif,
  encodePrivateKeyWif,
  deriveHdPrivateNodeFromSeed,
  deriveHdPath,
  generatePrivateKey,
} from "@bitauth/libauth";

import { mnemonicToSeedSync, generateMnemonic } from "bip39";
import { NetworkType, prefixFromNetworkMap, UnitEnum } from "../enum.js";

import { Network, HeaderI, TxI, NFTCapability } from "../interface.js";

import { networkPrefixMap } from "../enum.js";
import { PrivateKeyI, UtxoI } from "../interface.js";

import { BaseWallet } from "./Base.js";
import { FeePaidByEnum, WalletTypeEnum } from "./enum.js";
import {
  CancelWatchFn,
  SendRequestOptionsI,
  WaitForTransactionOptions,
  WaitForTransactionResponse,
  WalletInfoI,
} from "./interface.js";

import {
  OpReturnData,
  SendRequest,
  SendRequestArray,
  SendRequestType,
  SendResponse,
  TokenMintRequest,
  TokenSendRequest,
  UtxoItem,
  UtxoResponse,
  XPubKey,
} from "./model.js";

import {
  buildEncodedTransaction,
  getSuitableUtxos,
  getFeeAmount,
} from "../transaction/Wif.js";

import { asSendRequestObject } from "../util/asSendRequestObject.js";
import {
  balanceFromSatoshi,
  balanceResponseFromSatoshi,
  BalanceResponse,
} from "../util/balanceObjectFromSatoshi.js";
import { checkWifNetwork } from "../util/checkWifNetwork.js";
import { deriveCashaddr } from "../util/deriveCashaddr.js";
import {
  derivePrefix,
  derivePublicKeyHash,
} from "../util/derivePublicKeyHash.js";
import { checkForEmptySeed } from "../util/checkForEmptySeed.js";
import { sanitizeUnit } from "../util/sanitizeUnit.js";
import { sumTokenAmounts, sumUtxoValue } from "../util/sumUtxoValue.js";
import { sumSendRequestAmounts } from "../util/sumSendRequestAmounts.js";
import { ElectrumRawTransaction } from "../network/interface.js";
import { getRelayFeeCache } from "../network/getRelayFeeCache.js";
import {
  RegTestSlp,
  RegTestWatchSlp,
  RegTestWifSlp,
  Slp,
  TestNetSlp,
  TestNetWatchSlp,
  TestNetWifSlp,
  WatchSlp,
  WifSlp,
} from "./Slp.js";
import axios from "axios";
import { SlpSendResponse } from "../slp/interface.js";
import { toCashAddress } from "../util/bchaddr.js";
import {
  RegTestUtil,
  RegTestWatchUtil,
  RegTestWifUtil,
  TestNetUtil,
  TestNetWatchUtil,
  TestNetWifUtil,
  Util,
  WatchUtil,
  WifUtil,
} from "./Util.js";
import { getNetworkProvider } from "../network/index.js";
import { generateRandomBytes } from "../util/randomBytes.js";
import { SignedMessageI, SignedMessage } from "../message/index.js";
import ElectrumNetworkProvider from "../network/ElectrumNetworkProvider.js";
import { amountInSatoshi } from "../util/amountInSatoshi.js";
import { getXPubKey } from "../util/getXPubKey.js";
import { DERIVATION_PATHS, DUST_UTXO_THRESHOLD } from "../constant.js";

import { TransactionHistoryI } from "../history/interface.js";
import { getAddressHistory } from "../history/electrumTransformer.js";
import { IdentitySnapshot, Registry } from "./bcmr-v1.schema.js";
import { BCMR } from "./Bcmr.js";

//#endregion Imports

/**
 * Class to manage a bitcoin cash wallet.
 */
export class Wallet extends BaseWallet {
  cashaddr?: string;
  derivationPath: string = "m/44'/0'/0'/0/0";
  parentDerivationPath: string = "m/44'/0'/0'";
  parentXPubKey?: string;
  privateKey?: Uint8Array;
  publicKeyCompressed?: Uint8Array;
  privateKeyWif?: string;
  publicKey?: Uint8Array;
  publicKeyHash?: Uint8Array;
  networkPrefix: CashAddressNetworkPrefix;
  _slp?: Slp;
  _slpAware: boolean = false; // a flag which activates utxo checking against an external slp indexer
  _slpSemiAware: boolean = false; // a flag which requires an utxo to have more than 546 sats to be spendable and counted in the balance
  _util?: Util;
  static signedMessage: SignedMessageI = new SignedMessage();

  //#region Accessors
  // interface to slp functions. see Slp.ts
  public get slp() {
    if (!this._slp) {
      this._slp = new Slp(this);
      this._slpAware = true;
    }

    return this._slp;
  }

  // interface to slp functions. see Slp.ts
  public static get slp() {
    return Slp;
  }

  // interface to util functions. see Util.ts
  public get util() {
    if (!this._util) {
      this._util = new Util(this);
    }

    return this._util;
  }

  // interface to util util. see Util.Util
  public static get util() {
    return Util;
  }

  public slpAware(value: boolean = true): Wallet {
    this._slpAware = value;
    return this;
  }

  public slpSemiAware(value: boolean = true): Wallet {
    this._slpSemiAware = value;
    return this;
  }

  public getNetworkProvider(network: Network = Network.MAINNET) {
    return getNetworkProvider(network);
  }

  /**
   *  explorerUrl   Web url to a transaction on a block explorer
   *
   * @param txId   transaction Id
   * @returns   Url string
   */
  public explorerUrl(txId: string) {
    const explorerUrlMap = {
      mainnet: "https://blockchair.com/bitcoin-cash/transaction/",
      testnet: "https://www.blockchain.com/bch-testnet/tx/",
      regtest: "",
    };

    return explorerUrlMap[this.network] + txId;
  }

  // Return wallet info
  public getInfo(): WalletInfoI {
    return {
      cashaddr: this.cashaddr,
      isTestnet: this.isTestnet,
      name: this.name,
      network: this.network as any,
      seed: this.mnemonic ? this.getSeed().seed : undefined,
      derivationPath: this.mnemonic ? this.getSeed().derivationPath : undefined,
      parentDerivationPath: this.mnemonic
        ? this.getSeed().parentDerivationPath
        : undefined,
      parentXPubKey: this.parentXPubKey ? this.parentXPubKey : undefined,
      publicKey: this.publicKey ? binToHex(this.publicKey!) : undefined,
      publicKeyHash: binToHex(this.publicKeyHash!),
      privateKey: this.privateKey ? binToHex(this.privateKey!) : undefined,
      privateKeyWif: this.privateKeyWif,
      walletId: this.toString(),
      walletDbEntry: this.toDbString(),
    };
  }

  // returns the public key hash for an address
  public getPublicKey(hex = false): string | Uint8Array {
    if (this.publicKey) {
      return hex ? binToHex(this.publicKey!) : this.publicKey;
    } else {
      throw Error(
        "The public key for this wallet is not known, perhaps the wallet was created to watch the *hash* of a public key? i.e. a cashaddress."
      );
    }
  }

  // returns the public key hash for an address
  public getPublicKeyCompressed(hex = false): string | Uint8Array {
    if (this.publicKeyCompressed) {
      return hex
        ? binToHex(this.publicKeyCompressed!)
        : this.publicKeyCompressed;
    } else {
      throw Error(
        "The compressed public key for this wallet is not known, perhaps the wallet was created to watch the *hash* of a public key? i.e. a cashaddress."
      );
    }
  }

  // returns the public key hash for an address
  public getPublicKeyHash(hex = false): string | Uint8Array {
    if (this.publicKeyHash) {
      return hex ? binToHex(this.publicKeyHash!) : this.publicKeyHash;
    } else {
      throw Error(
        "The public key hash for this wallet is not known. If this wallet was created from the constructor directly, calling the deriveInfo() function may help. "
      );
    }
  }

  //#endregion

  //#region Constructors and Statics
  constructor(
    name = "",
    network = NetworkType.Mainnet,
    walletType = WalletTypeEnum.Seed
  ) {
    super(name, network, walletType);
    this.networkPrefix = prefixFromNetworkMap[this.network];
  }

  /**
   * fromWIF - create a wallet using the private key supplied in `Wallet Import Format`
   *
   * @param wif   WIF encoded private key string
   *
   * @returns instantiated wallet
   */
  public static async fromWIF<T extends typeof Wallet>(
    this: T,
    wif: string
  ): Promise<InstanceType<T>> {
    return new this().fromWIF(wif) as InstanceType<T>;
  }

  /**
   * fromCashaddr - create a watch-only wallet in the network derived from the address
   *
   * such kind of wallet does not have a private key and is unable to spend any funds
   * however it still allows to use many utility functions such as getting and watching balance, etc.
   *
   * @param address   cashaddress of a wallet
   *
   * @returns instantiated wallet
   */
  public static async fromCashaddr<T extends typeof Wallet>(
    this: T,
    address: string
  ): Promise<InstanceType<T>> {
    const prefix = derivePrefix(address);
    const networkType = networkPrefixMap[prefix] as NetworkType;
    return new this("", networkType, WalletTypeEnum.Watch).watchOnly(
      address
    ) as InstanceType<T>;
  }

  /**
   * fromSlpaddr - create an SLP aware watch-only wallet in the network derived from the address
   *
   * such kind of wallet does not have a private key and is unable to spend any funds
   * however it still allows to use many utility functions such as getting and watching balance, etc.
   *
   * @param address   slpaddress of a wallet
   *
   * @returns instantiated wallet
   */
  public static async fromSlpaddr<T extends typeof Wallet>(
    this: T,
    address: string
  ): Promise<InstanceType<T>> {
    return this.fromCashaddr(toCashAddress(address)) as InstanceType<T>;
  }
  //#endregion Constructors and Statics

  //#region Protected implementations
  protected async generate(): Promise<this> {
    if (this.walletType === WalletTypeEnum.Wif) {
      return await this._generateWif();
    } else if (this.walletType === WalletTypeEnum.Watch) {
      return this;
    } else if (this.walletType === WalletTypeEnum.Hd) {
      throw Error("Not implemented");
    } else if (this.walletType === WalletTypeEnum.Seed) {
      return await this._generateMnemonic();
    } else {
      console.log(this.walletType);
      throw Error(`Could not determine walletType: ${this.walletType}`);
    }
  }

  private async _generateWif() {
    if (!this.privateKey) {
      this.privateKey = generatePrivateKey(() => generateRandomBytes(32));
    }
    return this.deriveInfo();
  }

  private async _generateMnemonic() {
    this.mnemonic = generateMnemonic();
    if (this.mnemonic.length == 0)
      throw Error("refusing to create wallet from empty mnemonic");
    let seed = mnemonicToSeedSync(this.mnemonic!);
    checkForEmptySeed(seed);
    let network = this.isTestnet ? "testnet" : "mainnet";
    this.parentXPubKey = await getXPubKey(
      seed,
      this.parentDerivationPath,
      network
    );

    let hdNode = deriveHdPrivateNodeFromSeed(seed);
    if (!hdNode.valid) {
      throw Error("Invalid private key derived from mnemonic seed");
    }

    let zerothChild = deriveHdPath(hdNode, this.derivationPath);
    if (typeof zerothChild === "string") {
      throw Error(zerothChild);
    }
    this.privateKey = zerothChild.privateKey;

    this.walletType = WalletTypeEnum.Seed;
    return await this.deriveInfo();
  }

  protected fromId = async (walletId: string): Promise<this> => {
    let [walletType, networkGiven, arg1]: string[] = walletId.split(":");

    if (this.network != networkGiven) {
      throw Error(`Network prefix ${networkGiven} to a ${this.network} wallet`);
    }

    // "wif:regtest:cNfsPtqN2bMRS7vH5qd8tR8GMvgXyL5BjnGAKgZ8DYEiCrCCQcP6"
    if (walletType === "wif") {
      return this.fromWIF(arg1);
    }

    return super.fromId(walletId);
  };

  public async getXPubKeys(paths?) {
    if (this.mnemonic) {
      if (paths) {
        let xPubKeys = await this.deriveHdPaths(paths);
        return [xPubKeys];
      } else {
        return await this.deriveHdPaths(DERIVATION_PATHS);
      }
    } else {
      throw Error("xpubkeys can only be derived from seed type wallets.");
    }
  }
  // Initialize wallet from a mnemonic phrase
  protected async fromSeed(
    mnemonic: string,
    derivationPath?: string
  ): Promise<this> {
    this.mnemonic = mnemonic;

    if (this.mnemonic.length == 0)
      throw Error("refusing to create wallet from empty mnemonic");
    let seed = mnemonicToSeedSync(this.mnemonic);
    checkForEmptySeed(seed);
    let hdNode = deriveHdPrivateNodeFromSeed(seed);
    if (!hdNode.valid) {
      throw Error("Invalid private key derived from mnemonic seed");
    }
    if (derivationPath) {
      this.derivationPath = derivationPath;

      // If the derivation path is for the first account child, set the parent derivation path
      let path = derivationPath.split("/");
      if (path.slice(-2).join("/") == "0/0") {
        this.parentDerivationPath = path.slice(0, -2).join("/");
      }
    }

    let zerothChild = deriveHdPath(hdNode, this.derivationPath);
    if (typeof zerothChild === "string") {
      throw Error(zerothChild);
    }
    this.privateKey = zerothChild.privateKey;

    let network = this.isTestnet ? "testnet" : "mainnet";
    this.parentXPubKey = await getXPubKey(
      seed,
      this.parentDerivationPath,
      network
    );

    this.walletType = WalletTypeEnum.Seed;
    await this.deriveInfo();
    return this;
  }

  // Get common xpub paths from zerothChild privateKey
  public async deriveHdPaths(hdPaths: string[]): Promise<any[]> {
    if (!this.mnemonic)
      throw Error("refusing to create wallet from empty mnemonic");
    let seed = mnemonicToSeedSync(this.mnemonic!);
    checkForEmptySeed(seed);
    let hdNode = deriveHdPrivateNodeFromSeed(seed);
    if (!hdNode.valid) {
      throw Error("Invalid private key derived from mnemonic seed");
    }

    let result: any[] = [];

    for (const path of hdPaths) {
      if (path === "m") {
        throw Error(
          "Storing or sharing of parent public key may lead to loss of funds. Storing or sharing *root* parent public keys is strongly discouraged, although all parent keys have risk. See: https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki#implications"
        );
      }
      let childNode = deriveHdPath(hdNode, path);
      if (typeof childNode === "string") {
        throw Error(childNode);
      }
      let node = deriveHdPublicNode(childNode);
      if (typeof node === "string") {
        throw Error(node);
      }
      let xPubKey = encodeHdPublicKey({
        network: this.network as HdKeyNetwork,
        node: node,
      });
      let key = new XPubKey({
        path: path,
        xPubKey: xPubKey,
      });

      result.push(await key.ready());
    }
    return await Promise.all(result).then((result) => {
      return result;
    });
  }

  // Initialize a watch only wallet from a cash addr
  protected async watchOnly(address: string): Promise<this> {
    this.walletType = WalletTypeEnum.Watch;
    let addressComponents = address.split(":");
    let addressPrefix, addressBase;
    if (addressComponents.length === 1) {
      addressBase = addressComponents.shift() as string;
      addressPrefix = derivePrefix(addressBase);
    } else {
      addressPrefix = addressComponents.shift() as string;
      addressBase = addressComponents.shift() as string;
      if (addressPrefix in networkPrefixMap) {
        if (networkPrefixMap[addressPrefix] != this.network) {
          throw Error(
            `a ${addressPrefix} address cannot be watched from a ${this.network} Wallet`
          );
        }
      }
    }

    this.cashaddr = `${addressPrefix}:${addressBase}`;
    this.address = this.cashaddr;
    this.publicKeyHash = derivePublicKeyHash(this.cashaddr);

    return this;
  }

  // Initialize wallet from Wallet Import Format
  protected async fromWIF(secret: string): Promise<this> {
    checkWifNetwork(secret, this.network);

    let wifResult = decodePrivateKeyWif(secret);

    if (typeof wifResult === "string") {
      throw Error(wifResult as string);
    }
    let resultData: PrivateKeyI = wifResult as PrivateKeyI;
    this.privateKey = resultData.privateKey;
    this.privateKeyWif = secret;
    this.walletType = WalletTypeEnum.Wif;
    await this.deriveInfo();
    return this;
  }

  protected async newRandom(name: string, dbName?: string): Promise<this> {
    dbName = dbName ? dbName : this.networkPrefix;
    return super.newRandom(name, dbName);
  }

  protected async named(
    name: string,
    dbName?: string,
    forceNew: boolean = false
  ): Promise<this> {
    dbName = dbName ? dbName : this.networkPrefix;
    return super.named(name, dbName, forceNew);
  }

  protected async replaceNamed(
    name: string,
    walletId: string,
    dbName?: string
  ): Promise<this> {
    dbName = dbName ? dbName : this.networkPrefix;
    return super.replaceNamed(name, walletId, dbName);
  }

  protected async namedExists(name: string, dbName?: string): Promise<boolean> {
    dbName = dbName ? dbName : this.networkPrefix;
    return super.namedExists(name, dbName);
  }
  //#endregion Protected Implementations

  //#region Serialization
  // Returns the serialized wallet as a string
  // If storing in a database, set asNamed to false to store secrets
  // In all other cases, the a named wallet is deserialized from the database
  //  by the name key
  public toString() {
    const result = super.toString();
    if (result) return result;

    if (this.walletType === WalletTypeEnum.Wif) {
      return `${this.walletType}:${this.network}:${this.privateKeyWif}`;
    }

    throw Error("toString unsupported wallet type");
  }

  //
  public toDbString() {
    const result = super.toDbString();
    if (result) return result;

    if (this.walletType === WalletTypeEnum.Wif) {
      return `${this.walletType}:${this.network}:${this.privateKeyWif}`;
    }

    throw Error("toDbString unsupported wallet type");
  }
  //#endregion Serialization

  //#region Funds
  //
  public async getAddressUtxos(address?: string): Promise<UtxoI[]> {
    if (!this.provider) {
      throw Error("Attempting to get utxos from wallet without a client");
    }

    if (!address) {
      address = this.cashaddr!;
    }

    if (this._slpAware) {
      const [bchUtxos, slpOutpoints] = await Promise.all([
        this.provider!.getUtxos(address),
        this.slp.getSlpOutpoints(),
      ]);
      return bchUtxos.filter(
        (bchutxo) =>
          slpOutpoints.findIndex(
            (slpOutpoint) => `${bchutxo.txid}:${bchutxo.vout}` === slpOutpoint
          ) === -1
      );
    } else if (this._slpSemiAware) {
      const bchUtxos: UtxoI[] = await this.provider!.getUtxos(address);
      return bchUtxos.filter(
        (bchutxo) => bchutxo.satoshis > DUST_UTXO_THRESHOLD
      );
    } else {
      return await this.provider!.getUtxos(address);
    }
  }

  /**
   * utxos Get unspent token outputs for the wallet
   * will return utxos only for the specified token if `tokenId` provided
   */
  public async getTokenUtxos(
    address: string,
    tokenId?: string
  ): Promise<UtxoI[]> {
    const utxos = await this.getAddressUtxos(address);
    return utxos.filter((val) =>
      tokenId ? val.token?.tokenId === tokenId : val.token
    );
  }

  /**
   * utxos Get unspent outputs for the wallet
   *
   */
  public async getUtxos() {
    if (!this.cashaddr) {
      throw Error("Attempted to get utxos without an address");
    }
    let utxos = await this.getAddressUtxos(this.cashaddr);
    let resp = new UtxoResponse();
    resp.utxos = await Promise.all(
      utxos.map(async (o: UtxoI) => {
        return UtxoItem.fromElectrum(o);
      })
    );
    return resp;
  }

  // gets wallet balance in sats, bch and usd
  public async getBalance(
    rawUnit?: string,
    usdPriceCache = true
  ): Promise<BalanceResponse | number> {
    if (rawUnit) {
      const unit = sanitizeUnit(rawUnit);
      return await balanceFromSatoshi(
        await this.getBalanceFromProvider(),
        unit,
        usdPriceCache
      );
    } else {
      return await balanceResponseFromSatoshi(
        await this.getBalanceFromProvider(),
        usdPriceCache
      );
    }
  }

  // gets wallet fungible token balance
  // for nft balance use getTokenUtxos
  public async getTokenBalance(tokenId: string): Promise<number> {
    const utxos = await this.getAddressUtxos(this.cashaddr!);
    return sumTokenAmounts(utxos, tokenId);
  }

  public async getAllTokenBalances(): Promise<Object> {
    const result = {};
    const utxos = await this.getTokenUtxos(this.cashaddr!);
    for (const utxo of utxos) {
      if (!result[utxo.token!.tokenId]) {
        result[utxo.token!.tokenId] = 0;
      }
      result[utxo.token!.tokenId] += utxo.token!.amount;
    }
    return result;
  }

  // Gets balance by summing value in all utxos in stats
  public async getBalanceFromUtxos(): Promise<number> {
    const utxos = await this.getAddressUtxos(this.cashaddr!);
    return sumUtxoValue(utxos);
  }

  // Gets balance from fulcrum
  public async getBalanceFromProvider(): Promise<number> {
    // Fulcrum reports balance of all utxos, including tokens, which is undesirable
    // // TODO not sure why getting the balance from a provider doesn't work
    // if (this._slpAware || this._slpSemiAware) {
    //   return await this.getBalanceFromUtxos();
    // } else {
    //   return await this.provider!.getBalance(this.cashaddr!);
    // }

    // FIXME
    return this.getBalanceFromUtxos();
  }

  // // waiting for any transaction hash of this wallet
  // // commented out until fulcrum supports new method https://github.com/cculianu/Fulcrum/pull/89
  // public watchAddress(callback: (txHash: string) => void): CancelWatchFn {
  //   return (this.provider! as ElectrumNetworkProvider).watchAddress(
  //     this.getDepositAddress(),
  //     callback
  //   );
  // }

  // // waiting for any transaction of this wallet
  // // commented out until fulcrum supports new method https://github.com/cculianu/Fulcrum/pull/89
  // public watchAddressTransactions(
  //   callback: (tx: ElectrumRawTransaction) => void
  // ): CancelWatchFn {
  //   return (this.provider! as ElectrumNetworkProvider).watchAddressTransactions(
  //     this.getDepositAddress(),
  //     callback
  //   );
  // }

  // sets up a callback to be called upon wallet's balance change
  // can be cancelled by calling the function returned from this one
  public watchBalance(
    callback: (balance: BalanceResponse) => void
  ): CancelWatchFn {
    return (this.provider! as ElectrumNetworkProvider).watchAddressStatus(
      this.getDepositAddress(),
      async (_status: string) => {
        const balance = (await this.getBalance()) as BalanceResponse;
        callback(balance);
      }
    );
  }

  // sets up a callback to be called upon wallet's BCH or USD balance change
  // if BCH balance does not change, the callback will be triggered every
  // @param `usdPriceRefreshInterval` milliseconds by polling for new BCH USD price
  // Since we want to be most sensitive to usd value change, we do not use the cached exchange rates
  // can be cancelled by calling the function returned from this one
  public watchBalanceUsd(
    callback: (balance: BalanceResponse) => void,
    usdPriceRefreshInterval = 30000
  ): CancelWatchFn {
    let usdPrice = -1;

    const _callback = async () => {
      const balance = (await this.getBalance(
        undefined,
        false
      )) as BalanceResponse;
      if (usdPrice !== balance.usd!) {
        usdPrice = balance.usd!;
        callback(balance);
      }
    };

    const watchCancel = (
      this.provider! as ElectrumNetworkProvider
    ).watchAddressStatus(this.getDepositAddress(), _callback);
    const interval = setInterval(_callback, usdPriceRefreshInterval);

    return async () => {
      await watchCancel();
      clearInterval(interval);
    };
  }

  // waits for address balance to be greater than or equal to the target value
  // this call halts the execution
  public async waitForBalance(
    value: number,
    rawUnit: UnitEnum = UnitEnum.BCH
  ): Promise<BalanceResponse> {
    return new Promise(async (resolve) => {
      const watchCancel = this.watchBalance(
        async (balance: BalanceResponse) => {
          const satoshiBalance = await amountInSatoshi(value, rawUnit);
          if (balance.sat! >= satoshiBalance) {
            await watchCancel();
            resolve(balance);
          }
        }
      );
    });
  }

  // sets up a callback to be called upon wallet's token balance change
  // can be cancelled by calling the function returned from this one
  public watchTokenBalance(
    tokenId: string,
    callback: (balance: number) => void
  ): CancelWatchFn {
    let previous: number | undefined = undefined;
    return (this.provider! as ElectrumNetworkProvider).watchAddressStatus(
      this.getDepositAddress(),
      async (_status: string) => {
        const balance = await this.getTokenBalance(tokenId);
        if (previous != balance) {
          callback(balance);
        }
        previous = balance;
      }
    );
  }

  // waits for address token balance to be greater than or equal to the target amount
  // this call halts the execution
  public async waitForTokenBalance(
    tokenId: string,
    amount: number
  ): Promise<number> {
    return new Promise(async (resolve) => {
      const watchCancel = this.watchTokenBalance(
        tokenId,
        async (balance: number) => {
          if (balance >= amount) {
            await watchCancel();
            resolve(balance);
          }
        }
      );
    });
  }

  public async getTokenInfo(
    tokenId: string
  ): Promise<IdentitySnapshot | undefined> {
    return BCMR.getTokenInfo(tokenId);
  }

  public async getMaxAmountToSend(
    params: {
      outputCount?: number;
      options?: SendRequestOptionsI;
    } = {
      outputCount: 1,
      options: {},
    }
  ): Promise<BalanceResponse> {
    if (!this.privateKey) {
      throw Error("Couldn't get network or private key for wallet.");
    }
    if (!this.cashaddr) {
      throw Error("attempted to send without a cashaddr");
    }

    if (params.options && params.options.slpAware) {
      this._slpAware = true;
    }

    if (params.options && params.options.slpSemiAware) {
      this._slpSemiAware = true;
    }

    let feePaidBy;
    if (params.options && params.options.feePaidBy) {
      feePaidBy = params.options.feePaidBy;
    } else {
      feePaidBy = FeePaidByEnum.change;
    }

    // get inputs
    let utxos: UtxoI[];
    if (params.options && params.options.utxoIds) {
      utxos = params.options.utxoIds.map((utxoId) =>
        UtxoItem.fromId(utxoId).asElectrum()
      );
    } else {
      utxos = (await this.getAddressUtxos(this.cashaddr)).filter(
        (utxo) => !utxo.token
      );
    }

    // Get current height to assure recently mined coins are not spent.
    const bestHeight = await this.provider!.getBlockHeight();

    // simulate outputs using the sender's address
    const sendRequest = new SendRequest({
      cashaddr: this.cashaddr,
      value: 100,
      unit: "sat",
    });
    const sendRequests = Array(params.outputCount)
      .fill(0)
      .map(() => sendRequest);

    const fundingUtxos = await getSuitableUtxos(
      utxos,
      undefined,
      bestHeight,
      feePaidBy,
      sendRequests
    );
    const relayFeePerByteInSatoshi = await getRelayFeeCache(this.provider!);
    const fee = await getFeeAmount({
      utxos: fundingUtxos,
      sendRequests: sendRequests,
      privateKey: this.privateKey,
      relayFeePerByteInSatoshi: relayFeePerByteInSatoshi,
      slpOutputs: [],
      feePaidBy: feePaidBy,
    });
    const spendableAmount = sumUtxoValue(fundingUtxos);

    let result = spendableAmount - fee;
    if (result < 0) {
      result = 0;
    }

    return await balanceResponseFromSatoshi(result);
  }

  /**
   * send Send some amount to an address
   * this function processes the send requests, encodes the transaction, sends it to the network
   * @returns (depending on the options parameter) the transaction id, new address balance and a link to the transaction on the blockchain explorer
   *
   * This is a first class function with REST analog, maintainers should strive to keep backward-compatibility
   *
   */
  public async send(
    requests:
      | SendRequest
      | TokenSendRequest
      | OpReturnData
      | Array<SendRequest | TokenSendRequest | OpReturnData>
      | SendRequestArray[],
    options?: SendRequestOptionsI
  ): Promise<SendResponse> {
    let { encodedTransaction, tokenIds } = await this.encodeTransaction(
      requests,
      undefined,
      options
    );

    const awaitTransactionPropagation =
      !options ||
      options.awaitTransactionPropagation === undefined ||
      options.awaitTransactionPropagation;

    const txId = await this.submitTransaction(
      encodedTransaction,
      awaitTransactionPropagation
    );

    let resp = new SendResponse({});
    resp.txId = txId;
    const queryBalance =
      !options || options.queryBalance === undefined || options.queryBalance;
    if (queryBalance) {
      resp.balance = (await this.getBalance()) as BalanceResponse;
    }
    resp.explorerUrl = this.explorerUrl(resp.txId);
    resp.tokenIds = tokenIds;
    return resp;
  }

  /**
   * sendMax Send all available funds to a destination cash address
   *
   * @param  {string} cashaddr destination cash address
   * @param  {SendRequestOptionsI} options Options of the send requests
   *
   * @returns (depending on the options parameter) the transaction id, new address balance and a link to the transaction on the blockchain explorer
   */
  public async sendMax(
    cashaddr: string,
    options?: SendRequestOptionsI
  ): Promise<SendResponse> {
    const txId = await this.sendMaxRaw(cashaddr, options);
    const queryBalance =
      !options || options.queryBalance === undefined || options.queryBalance;
    return {
      txId: txId,
      balance: queryBalance
        ? ((await this.getBalance()) as BalanceResponse)
        : undefined,
      explorerUrl: this.explorerUrl(txId),
    };
  }

  /**
   * sendMaxRaw (internal) Send all available funds to a destination cash address
   *
   * @param  {string} cashaddr destination cash address
   * @param  {SendRequestOptionsI} options Options of the send requests
   *
   * @returns the transaction id sent to the network
   */
  private async sendMaxRaw(
    cashaddr: string,
    options?: SendRequestOptionsI
  ): Promise<string> {
    let maxSpendableAmount = await this.getMaxAmountToSend({
      outputCount: 1,
      options: options,
    });
    if (maxSpendableAmount.sat === undefined) {
      throw Error("no Max amount to send");
    }
    let sendRequest = new SendRequest({
      cashaddr: cashaddr,
      value: maxSpendableAmount.sat,
      unit: "sat",
    });

    const { encodedTransaction } = await this.encodeTransaction(
      [sendRequest],
      true,
      options
    );
    const awaitTransactionPropagation =
      !options ||
      options.awaitTransactionPropagation === undefined ||
      options.awaitTransactionPropagation;

    const txId = await this.submitTransaction(
      encodedTransaction,
      awaitTransactionPropagation
    );

    return txId;
  }

  /**
   * encodeTransaction Encode and sign a transaction given a list of sendRequests, options and estimate fees.
   * @param  {SendRequest[]} sendRequests SendRequests
   * @param  {boolean} discardChange=false
   * @param  {SendRequestOptionsI} options Options of the send requests
   */
  public async encodeTransaction(
    requests:
      | SendRequest
      | TokenSendRequest
      | OpReturnData
      | Array<SendRequest | TokenSendRequest | OpReturnData>
      | SendRequestArray[],
    discardChange: boolean = false,
    options?: SendRequestOptionsI
  ) {
    let sendRequests = asSendRequestObject(requests);

    if (!this.privateKey) {
      throw new Error(
        `Wallet ${this.name} is missing either a network or private key`
      );
    }
    if (!this.cashaddr) {
      throw Error("attempted to send without a cashaddr");
    }

    if (options && options.slpAware) {
      this._slpAware = true;
    }

    if (options && options.slpSemiAware) {
      this._slpSemiAware = true;
    }

    let feePaidBy;
    if (options && options.feePaidBy) {
      feePaidBy = options.feePaidBy;
    } else {
      feePaidBy = FeePaidByEnum.change;
    }

    let changeAddress;
    if (options && options.changeAddress) {
      changeAddress = options.changeAddress;
    } else {
      changeAddress = "";
    }

    let checkTokenQuantities: boolean = true;
    if (options && options.checkTokenQuantities === false) {
      checkTokenQuantities = false;
    }

    // get inputs from options or query all inputs
    let utxos: UtxoI[];
    if (options && options.utxoIds) {
      utxos = options.utxoIds.map((utxoId) =>
        typeof utxoId === "string"
          ? UtxoItem.fromId(utxoId).asElectrum()
          : utxoId
      );
    } else {
      utxos = await this.getAddressUtxos(this.cashaddr);
    }

    const addTokenChangeOutputs = (
      inputs: UtxoI[],
      outputs: SendRequestType[]
    ) => {
      // allow for implicit token burn if the total amount sent is less than user had
      // allow for token genesis, creating more tokens than we had before (0)
      if (!checkTokenQuantities) {
        return;
      }
      const allTokenInputs = inputs.filter((val) => val.token);
      const allTokenOutputs = outputs.filter(
        (val) => val instanceof TokenSendRequest
      ) as TokenSendRequest[];
      const tokenIds = allTokenOutputs
        .map((val) => val.tokenId)
        .filter((val, idx, arr) => arr.indexOf(val) === idx);
      for (let tokenId of tokenIds) {
        const tokenInputs = allTokenInputs.filter(
          (val) => val.token?.tokenId === tokenId
        );
        const inputAmountSum = tokenInputs.reduce(
          (prev, cur) => prev + cur.token!.amount,
          0
        );
        const tokenOutputs = allTokenOutputs.filter(
          (val) => val.tokenId === tokenId
        );
        const outputAmountSum = tokenOutputs.reduce(
          (prev, cur) => prev + cur.amount,
          0
        );
        const change = inputAmountSum - outputAmountSum;
        if (change < 0) {
          throw new Error("Not enough token amount to send");
        }
        if (change > 0) {
          outputs.push(
            new TokenSendRequest({
              cashaddr: changeAddress || this.cashaddr,
              amount: change,
              tokenId: tokenId,
              commitment: tokenOutputs[0].commitment,
              capability: tokenOutputs[0].capability,
              value: tokenOutputs[0].value,
            })
          );
        }
      }
    };
    addTokenChangeOutputs(utxos, sendRequests);

    const bestHeight = await this.provider!.getBlockHeight()!;
    const spendAmount = await sumSendRequestAmounts(sendRequests);

    if (utxos.length === 0) {
      throw Error("There were no Unspent Outputs");
    }
    if (typeof spendAmount !== "bigint") {
      throw Error("Couldn't get spend amount when building transaction");
    }

    const relayFeePerByteInSatoshi = await getRelayFeeCache(this.provider!);
    const feeEstimate = await getFeeAmount({
      utxos: utxos,
      sendRequests: sendRequests,
      privateKey: this.privateKey,
      relayFeePerByteInSatoshi: relayFeePerByteInSatoshi,
      slpOutputs: [],
      feePaidBy: feePaidBy,
    });

    const fundingUtxos = await getSuitableUtxos(
      utxos,
      BigInt(spendAmount) + BigInt(feeEstimate),
      bestHeight,
      feePaidBy,
      sendRequests
    );
    if (fundingUtxos.length === 0) {
      throw Error(
        "The available inputs couldn't satisfy the request with fees"
      );
    }
    const fee = await getFeeAmount({
      utxos: fundingUtxos,
      sendRequests: sendRequests,
      privateKey: this.privateKey,
      relayFeePerByteInSatoshi: relayFeePerByteInSatoshi,
      slpOutputs: [],
      feePaidBy: feePaidBy,
    });
    const encodedTransaction = await buildEncodedTransaction(
      fundingUtxos,
      sendRequests,
      this.privateKey,
      fee,
      discardChange,
      [],
      feePaidBy,
      changeAddress
    );

    const tokenIds = [
      ...fundingUtxos
        .filter((val) => val.token?.tokenId)
        .map((val) => val.token!.tokenId),
      ...sendRequests
        .filter((val) => val instanceof TokenSendRequest)
        .map((val) => (val as TokenSendRequest).tokenId),
    ].filter((value, index, array) => array.indexOf(value) === index);

    return { encodedTransaction, tokenIds: tokenIds };
  }

  /**
   * Create new cashtoken, both funglible and non-fungible (NFT)
   * Refer to spec https://github.com/bitjson/cashtokens
   * @param  {number} options.amount amount of *fungible* tokens to create
   * @param  {NFTCapability?} options.capability capability of new NFT
   * @param  {string?} options.commitment NFT commitment message
   * @param  {string?} options.cashaddr cash address to send the created token UTXO to; if undefined will default to your address
   * @param  {number?} options.value satoshi value to send alongside with tokens; if undefined will default to 1000 satoshi
   */
  public async genesis(options: {
    amount?: number;
    capability?: NFTCapability;
    commitment?: string;
    cashaddr?: string;
    value?: number;
  }) {
    return this.send(
      new TokenSendRequest({
        cashaddr: options.cashaddr || this.cashaddr!,
        amount: options.amount,
        tokenId: "",
        value: options.value,
        capability: options.capability,
        commitment: options.commitment,
      }),
      {
        checkTokenQuantities: false,
        queryBalance: false,
      }
    );
  }

  /**
   * Mint new NFT cashtoken using an existing minting token
   * Refer to spec https://github.com/bitjson/cashtokens
   * @param  {string} tokenId tokenId of an NFT to mint
   * @param  {TokenMintRequest | TokenMintRequest[]} mintRequests mint requests with new token properties and recipients
   * @param  {boolean} deduceTokenAmount if minting token contains fungible amount, deduce from it by amount of minted tokens
   */
  public async mint(
    tokenId: string,
    mintRequests: TokenMintRequest | Array<TokenMintRequest>,
    deduceTokenAmount: boolean = true
  ) {
    if (!Array.isArray(mintRequests)) {
      mintRequests = [mintRequests];
    }

    const utxos = await this.getAddressUtxos(this.cashaddr!);
    const nftUtxos = utxos.filter(
      (val) =>
        val.token?.tokenId === tokenId &&
        val.token?.capability != NFTCapability.none
    );
    if (!nftUtxos.length) {
      throw new Error(
        "You do not have any token UTXOs with minting capability for specified tokenId"
      );
    }
    const newAmount =
      deduceTokenAmount && nftUtxos[0].token!.amount > 0
        ? nftUtxos[0].token!.amount - mintRequests.length
        : nftUtxos[0].token!.amount;
    const safeNewAmount = Math.max(0, newAmount);
    const mintingInput = new TokenSendRequest({
      cashaddr: this.cashaddr!,
      tokenId: tokenId,
      capability: nftUtxos[0].token!.capability,
      commitment: nftUtxos[0].token!.commitment,
      amount: safeNewAmount,
      value: nftUtxos[0].satoshis,
    });
    return this.send(
      [
        mintingInput,
        ...mintRequests.map(
          (val) =>
            new TokenSendRequest({
              cashaddr: val.cashaddr || this.cashaddr!,
              amount: 0,
              tokenId: tokenId,
              value: val.value,
              capability: val.capability,
              commitment: val.commitment,
            })
        ),
      ],
      {
        checkTokenQuantities: false,
        queryBalance: false,
      }
    );
  }

  /**
   * Perform an explicit token burning by spending a token utxo to an OP_RETURN
   *
   * Behaves differently for fungible and non-fungible tokens:
   *  * NFTs are always "destroyed"
   *  * FTs' amount is reduced by the amount specified, if 0 FT amount is left and no NFT present, the token is "destroyed"
   *
   * Refer to spec https://github.com/bitjson/cashtokens
   * @param  {string} burnRequest.tokenId tokenId of a token to burn
   * @param  {NFTCapability} burnRequest.capability capability of the NFT token to select, optional
   * @param  {string} burnRequest.commitment commitment of the NFT token to select, optional
   * @param  {number?} burnRequest.amount amount of fungible tokens to burn, optional
   * @param  {string?} burnRequest.cashaddr address to return token and satoshi change to
   * @param  {string?} message optional message to include in OP_RETURN
   */
  public async burn(
    burnRequest: {
      tokenId: string;
      capability?: NFTCapability;
      commitment?: string;
      amount?: number;
      cashaddr?: string;
    },
    message?: string
  ) {
    const utxos = await this.getAddressUtxos(this.cashaddr!);
    const tokenUtxos = utxos.filter(
      (val) =>
        val.token?.tokenId === burnRequest.tokenId &&
        val.token?.capability === burnRequest.capability &&
        val.token?.commitment === burnRequest.commitment &&
        val.token?.capability === burnRequest.capability
    );

    if (!tokenUtxos.length) {
      throw new Error("You do not have suitable token UTXOs to perform burn");
    }

    const totalFungibleAmount = tokenUtxos.reduce(
      (prev, cur) => prev + (cur.token?.amount || 0),
      0
    );
    const fungibleBurnAmount =
      burnRequest.amount && burnRequest.amount > 0 ? burnRequest.amount! : 0;
    const destroyFT = totalFungibleAmount === fungibleBurnAmount;
    const hasNFT = burnRequest.capability || burnRequest.commitment;

    let utxoIds: UtxoI[] = [];
    let changeSendRequests;
    if (hasNFT) {
      // does not have FT tokens, let us destroy the token completely
      if (totalFungibleAmount === 0) {
        changeSendRequests = [];
        utxoIds.push(tokenUtxos[0]);
      } else {
        // if there are FT, reduce their amount
        const newAmount = totalFungibleAmount - fungibleBurnAmount;
        const safeNewAmount = Math.max(0, newAmount);
        changeSendRequests = [
          new TokenSendRequest({
            cashaddr: burnRequest.cashaddr || this.cashaddr!,
            tokenId: burnRequest.tokenId,
            capability: burnRequest.capability,
            commitment: burnRequest.commitment,
            amount: safeNewAmount,
            value: tokenUtxos[0].satoshis,
          }),
        ];
      }
    } else {
      // if we are burning last fughible tokens, let us destroy the token completely
      if (totalFungibleAmount === fungibleBurnAmount) {
        changeSendRequests = [];
        utxoIds.push(tokenUtxos[0]);
      } else {
        // reduce the FT amount
        const newAmount = totalFungibleAmount - fungibleBurnAmount;
        const safeNewAmount = Math.max(0, newAmount);
        changeSendRequests = [
          new TokenSendRequest({
            cashaddr: burnRequest.cashaddr || this.cashaddr!,
            tokenId: burnRequest.tokenId,
            amount: safeNewAmount,
            value: tokenUtxos[0].satoshis,
          }),
        ];
      }
    }

    const opReturn = OpReturnData.fromString(message || "");
    return this.send([opReturn, ...changeSendRequests], {
      checkTokenQuantities: false,
      queryBalance: false,
      utxoIds: utxoIds.length > 0 ? utxoIds : undefined,
    });
  }

  // Submit a raw transaction
  public async submitTransaction(
    transaction: Uint8Array,
    awaitPropagation: boolean = true
  ): Promise<string> {
    if (!this.provider) {
      throw Error("Wallet network provider was not initialized");
    }
    let rawTransaction = binToHex(transaction);
    return await this.provider.sendRawTransaction(
      rawTransaction,
      awaitPropagation
    );
  }

  // gets transaction history of this wallet
  public async getRawHistory(): Promise<TxI[]> {
    return await this.provider!.getHistory(this.cashaddr!);
  }

  // gets transaction history of this wallet
  public async getHistory(
    unit: UnitEnum,
    start?: number,
    count?: number,
    collapseChange?: boolean
  ): Promise<TransactionHistoryI> {
    return getAddressHistory(
      this.cashaddr!,
      this.provider!,
      unit,
      start,
      count,
      collapseChange
    );
  }

  // gets last transaction of this wallet
  public async getLastTransaction(
    confirmedOnly: boolean = false
  ): Promise<ElectrumRawTransaction | null> {
    let history: TxI[] = await this.getRawHistory();
    if (confirmedOnly) {
      history = history.filter((val) => val.height > 0);
    }

    if (!history.length) {
      return null;
    }

    const [lastTx] = history.slice(-1);
    return this.provider!.getRawTransactionObject(lastTx.tx_hash);
  }

  // waits for next transaction, program execution is halted
  public async waitForTransaction(
    options: WaitForTransactionOptions = {
      getTransactionInfo: true,
      getBalance: false,
      txHash: undefined,
    }
  ): Promise<WaitForTransactionResponse> {
    if (options.getTransactionInfo === undefined) {
      options.getTransactionInfo = true;
    }

    return new Promise(async (resolve) => {
      let txHashSeen = false;

      const makeResponse = async (txHash?: string) => {
        const response = <WaitForTransactionResponse>{};
        const promises: any[] = [undefined, undefined];

        if (options.getBalance === true) {
          promises[0] = this.getBalance();
        }

        if (options.getTransactionInfo === true) {
          if (!txHash) {
            promises[1] = this.getLastTransaction();
          } else {
            promises[1] = this.provider!.getRawTransactionObject(txHash);
          }
        }

        const result = await Promise.all(promises);
        response.balance = result[0];
        response.transactionInfo = result[1];

        return response;
      };

      // waiting for a specific transaction to propagate
      if (options.txHash) {
        const waitForTransactionCallback = async (data) => {
          if (data && data[0] === options.txHash!) {
            txHashSeen = true;
            this.provider!.unsubscribeFromTransaction(
              options.txHash!,
              waitForTransactionCallback
            );

            resolve(makeResponse(options.txHash!));
          }
        };

        this.provider!.subscribeToTransaction(
          options.txHash,
          waitForTransactionCallback
        );
        return;
      }

      // waiting for any address transaction
      const watchCancel = (
        this.provider! as ElectrumNetworkProvider
      ).watchAddressStatus(this.getDepositAddress(), async (_status) => {
        watchCancel();
        resolve(makeResponse());
      });
    });
  }

  /**
   * watchBlocks Watch network blocks
   *
   * @param callback callback with a block header object
   *
   * @returns a function which will cancel watching upon evaluation
   */
  public watchBlocks(callback: (header: HeaderI) => void): CancelWatchFn {
    return (this.provider! as ElectrumNetworkProvider).watchBlocks(callback);
  }

  /**
   * waitForBlock Wait for a network block
   *
   * @param height if specified waits for this exact blockchain height, otherwise resolves with the next block
   *
   */
  public async waitForBlock(height?: number): Promise<HeaderI> {
    return (this.provider! as ElectrumNetworkProvider).waitForBlock(height);
  }
  //#endregion Funds

  //#region Private implementation details
  private async deriveInfo() {
    const publicKey = secp256k1.derivePublicKeyUncompressed(this.privateKey!);
    if (typeof publicKey === "string") {
      throw new Error(publicKey);
    }
    this.publicKey = publicKey;
    const publicKeyCompressed = secp256k1.derivePublicKeyCompressed(
      this.privateKey!
    );
    if (typeof publicKeyCompressed === "string") {
      throw new Error(publicKeyCompressed);
    }
    this.publicKeyCompressed = publicKeyCompressed;
    const networkType =
      this.network === NetworkType.Regtest ? NetworkType.Testnet : this.network;
    this.privateKeyWif = encodePrivateKeyWif(this.privateKey!, networkType);
    checkWifNetwork(this.privateKeyWif, this.network);

    this.cashaddr = (await deriveCashaddr(
      this.privateKey!,
      this.networkPrefix
    )) as string;
    this.address = this.cashaddr;
    this.publicKeyHash = derivePublicKeyHash(this.cashaddr!);
    return this;
  }
  //#endregion Private implementation details

  //#region Signing
  // Convenience wrapper to sign interface
  public async sign(message: string) {
    return await Wallet.signedMessage.sign(message, this.privateKey!);
  }

  // Convenience wrapper to verify interface
  public async verify(message: string, sig: string, publicKey?: Uint8Array) {
    return await Wallet.signedMessage.verify(
      message,
      sig,
      this.cashaddr!,
      publicKey
    );
  }
  //#endregion Signing
}

/**
 * Class to manage a testnet wallet.
 */
export class TestNetWallet extends Wallet {
  static networkPrefix = CashAddressNetworkPrefix.testnet;
  static faucetServer = "https://rest-unstable.mainnet.cash";
  constructor(name = "") {
    super(name, NetworkType.Testnet);
  }

  // will receive 10000 testnet satoshi, rate limits apply
  async getTestnetSatoshis(): Promise<string> {
    try {
      const response = await axios.post(
        `${TestNetWallet.faucetServer}/faucet/get_testnet_bch`,
        { cashaddr: this.cashaddr! }
      );
      const data = response.data;
      return data.txId;
    } catch (e) {
      // console.log(e);
      // console.log(e.response ? e.response.data : "");
      throw e;
    }
  }

  // be nice and return them back
  async returnTestnetSatoshis(): Promise<SendResponse> {
    try {
      const response = await axios.post(
        `${TestNetWallet.faucetServer}/faucet/get_addresses`
      );
      const data = response.data;
      return await this.slpAware().sendMax(data.bchtest);
    } catch (e: any) {
      console.log(e);
      console.log(e.response ? e.response.data : "");
      throw e;
    }
  }

  // will receive 10 testnet tokens, rate limits apply
  async getTestnetSlp(tokenId: string): Promise<string> {
    try {
      const response = await axios.post(
        `${TestNetWallet.faucetServer}/faucet/get_testnet_slp`,
        { slpaddr: this.slp.slpaddr, tokenId: tokenId }
      );
      const data = response.data;
      return data.txId;
    } catch (e) {
      //console.log(e);
      //console.log(e.response ? e.response.data : "");
      throw e;
    }
  }

  // be nice and return them back
  async returnTestnetSlp(tokenId: string): Promise<SlpSendResponse> {
    try {
      const response = await axios.post(
        `${TestNetWallet.faucetServer}/faucet/get_addresses`
      );
      const data = response.data;
      return await this.slp.sendMax(data.slptest, tokenId);
    } catch (e: any) {
      console.log(e);
      console.log(e.response ? e.response.data : "");
      throw e;
    }
  }

  // interface to static slp functions. see Slp.ts
  public static get slp() {
    return TestNetSlp;
  }

  // interface to static util functions. see Util.ts
  public static get util() {
    return TestNetUtil;
  }
}

/**
 * Class to manage a regtest wallet.
 */
export class RegTestWallet extends Wallet {
  static networkPrefix = CashAddressNetworkPrefix.regtest;
  constructor(name = "") {
    super(name, NetworkType.Regtest);
  }

  // interface to static slp functions. see Slp.ts
  public static get slp() {
    return RegTestSlp;
  }

  // interface to static util functions. see Util.ts
  public static get util() {
    return RegTestUtil;
  }
}

/**
 * Class to manage a bitcoin cash wif wallet.
 */
export class WifWallet extends Wallet {
  static networkPrefix = CashAddressNetworkPrefix.mainnet;
  static walletType = WalletTypeEnum.Wif;
  constructor(name = "") {
    super(name, NetworkType.Mainnet, WalletTypeEnum.Wif);
  }

  // interface to static slp functions. see Slp.ts
  public static get slp() {
    return WifSlp;
  }

  // interface to static util functions. see Util.ts
  public static get util() {
    return WifUtil;
  }
}

/**
 * Class to manage a testnet wif wallet.
 */
export class TestNetWifWallet extends Wallet {
  static networkPrefix = CashAddressNetworkPrefix.testnet;
  static walletType = WalletTypeEnum.Wif;
  constructor(name = "") {
    super(name, NetworkType.Testnet, WalletTypeEnum.Wif);
  }

  // interface to static slp functions. see Slp.ts
  public static get slp() {
    return TestNetWifSlp;
  }

  // interface to static util functions. see Util.ts
  public static get util() {
    return TestNetWifUtil;
  }
}

/**
 * Class to manage a regtest wif wallet.
 */
export class RegTestWifWallet extends Wallet {
  static networkPrefix = CashAddressNetworkPrefix.regtest;
  static walletType = WalletTypeEnum.Wif;
  constructor(name = "") {
    super(name, NetworkType.Regtest, WalletTypeEnum.Wif);
  }

  // interface to static slp functions. see Slp.ts
  public static get slp() {
    return RegTestWifSlp;
  }

  // interface to static util functions. see Util.ts
  public static get util() {
    return RegTestWifUtil;
  }
}

/**
 * Class to manage a bitcoin cash watch wallet.
 */
export class WatchWallet extends Wallet {
  static networkPrefix = CashAddressNetworkPrefix.mainnet;
  static walletType = WalletTypeEnum.Watch;
  constructor(name = "") {
    super(name, NetworkType.Mainnet, WalletTypeEnum.Watch);
  }

  // interface to static slp functions. see Slp.ts
  public static get slp() {
    return WatchSlp;
  }

  // interface to static util functions. see Util.ts
  public static get util() {
    return WatchUtil;
  }
}

/**
 * Class to manage a testnet watch wallet.
 */
export class TestNetWatchWallet extends Wallet {
  static networkPrefix = CashAddressNetworkPrefix.testnet;
  static walletType = WalletTypeEnum.Watch;
  constructor(name = "") {
    super(name, NetworkType.Testnet, WalletTypeEnum.Watch);
  }

  // interface to static slp functions. see Slp.ts
  public static get slp() {
    return TestNetWatchSlp;
  }

  // interface to static util functions. see Util.ts
  public static get util() {
    return TestNetWatchUtil;
  }
}

/**
 * Class to manage a regtest watch wallet.
 */
export class RegTestWatchWallet extends Wallet {
  static networkPrefix = CashAddressNetworkPrefix.regtest;
  static walletType = WalletTypeEnum.Watch;
  constructor(name = "") {
    super(name, NetworkType.Regtest, WalletTypeEnum.Watch);
  }

  // interface to static slp functions. see Slp.ts
  public static get slp() {
    return RegTestWatchSlp;
  }

  // interface to static util functions. see Util.ts
  public static get util() {
    return RegTestWatchUtil;
  }
}

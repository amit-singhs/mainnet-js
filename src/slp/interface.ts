import BigNumber from "bignumber.js";
import { UtxoI } from "../interface";

export enum SlpTokenType {
  Type1 = 0x01,
  NftParent = 0x81,
  NftChild = 0x41,
}

export interface SlpDbResponse {
  t: any[];
  u: any[];
  c: any[];
  g: any[];
  a: any[];
  x: any[];
  s: any[];
}

export interface SlpTokenBalance {
  value: BigNumber;
  ticker: string;
  name: string;
  tokenId: string;
  type: SlpTokenType;
}

export interface SlpUtxoI extends UtxoI {
  value: BigNumber;
  decimals: number;
  ticker: string;
  tokenId: string;
  type: SlpTokenType;
}

export interface SlpFormattedUtxo {
  ticker: string;
  tokenId: string;
  value: string;
  satoshis: number;
  decimals: number;
  txId: string;
  index: number;
  utxoId: string;
  type: SlpTokenType;
}

export interface SlpSendRequest {
  slpaddr: string;
  value: BigNumber.Value;
  tokenId: string;
}

export interface SlpTokenInfo {
  name: string;
  ticker: string;
  tokenId: string;
  initialAmount: BigNumber.Value;
  decimals: number;
  documentUrl?: string;
  documentHash?: string;
  type: SlpTokenType;
}

export interface SlpGenesisOptions {
  name: string;
  ticker: string;
  initialAmount: BigNumber.Value;
  decimals: number;
  documentUrl?: string;
  documentHash?: string;
  endBaton?: boolean;
  type?: SlpTokenType;
  tokenReceiverSlpAddr?: string;
  batonReceiverSlpAddr?: string;
}

export interface SlpMintOptions {
  value: BigNumber.Value;
  tokenId: string;
  endBaton?: boolean;
  tokenReceiverSlpAddr?: string;
  batonReceiverSlpAddr?: string;
}

export interface SlpGenesisResult {
  tokenId: string;
  balance: SlpTokenBalance;
}

export interface SlpSendResponse {
  txId: string;
  balance: SlpTokenBalance;
}

export interface SlpMintResult {
  txId: string;
  balance: SlpTokenBalance;
}

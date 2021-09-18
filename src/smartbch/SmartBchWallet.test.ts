import { ethers } from "ethers";
import { delay } from "../util/delay";
import {
  RegTestSmartBchWallet,
  SmartBchWallet,
  TestNetSmartBchWallet,
} from "../smartbch/SmartBchWallet";
import { BalanceResponse } from "../util/balanceObjectFromSatoshi";
import { JsonRpcProvider } from "@ethersproject/providers";

describe(`Test Ethereum functions`, () => {
  test.skip("Filter logs", async () => {
    expect(
      ethers.utils.hexZeroPad("0x8486c538dcbd6a707c5b3f730b6413286fe8c854", 32)
    ).toBe(
      "0x0000000000000000000000008486c538dcbd6a707c5b3f730b6413286fe8c854"
    );
    const filter = {
      // address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
      topics: [
        // '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        null,
        [
          "0x000000000000000000000000dad2bacbc2d2507eedb74a4500b6e1d1ef2d69a7",
          "0x000000000000000000000000691f987fd150967d6b6bd7e7b3d04e9dbc1f4efc",
        ],
        // id("Transfer(address,address,uint256)"),
        // "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        // null,
        // "0x000000000000000000000000190cdef5817afc5d999a81f603562a8990373fbb",
        // null,
        // '0x0000000000000000000000003dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3',
        // '0x000000000000000000000000e3d9988f676457123c5fd01297605efdd0cba1ae'
        // null,
        // "0x0000000000000000000000008486c538dcbd6a707c5b3f730b6413286fe8c854"
        // [
        // hexZeroPad("0x8486c538dcbd6a707c5b3f730b6413286fe8c854", 32),
        // ],
        // [
        //   hexZeroPad("0xB55438d2261C9dFA801848c89377D77fa35a1917", 32),
        // ]
      ],
    };

    const watchWallet = await SmartBchWallet.watchOnly(
      "0xB55438d2261C9dFA801848c89377D77fa35a1917"
    );
    // console.log(await watchWallet.provider!.getLogs(filter));

    const provider = watchWallet.provider as JsonRpcProvider;

    const filterId = await provider.send("eth_newPendingTransactionFilter", []);
    const logs = await provider.send("eth_getFilterChanges", [filterId]);
    console.log(logs);

    // console.log(await watchWallet.erc20.contract.contract.interface.encodeFilterTopics(watchWallet.erc20.contract.contract.interface.events["Transfer(address,address,uint256)"], []));
    // console.log(await watchWallet.erc20.contract.contract.filters.Transfer('0xf8ba35cc5493e2dc4e0780d4e299fd627265baaf',
    // '0xa364cf694ce7bf65b67fc595a6f9403281beec59'));
  });

  test("Test SmartBch signing", async () => {
    const wallet = await SmartBchWallet.newRandom();
    const sig = await wallet.sign("test");
    const signResult = await wallet.verify("test", sig.signature);
    expect(signResult.valid).toBe(true);
  });

  test("Test SmartBch sending", async () => {
    const feeDelta = 0.0003; // bch

    const alice = await RegTestSmartBchWallet.fromId(
      process.env.SBCH_ALICE_ID!
    );
    const balance = (await alice.getBalance()) as BalanceResponse;

    const bob = await RegTestSmartBchWallet.newRandom();
    const sendResult = await alice.send(
      { address: bob.getDepositAddress(), value: 0.1, unit: "bch" },
      {},
      { gasPrice: 10 ** 10 }
    );
    expect(sendResult[0].balance!.bch!).toBeGreaterThan(
      balance.bch! - (0.1 + feeDelta)
    );
    expect(((await bob.getBalance()) as BalanceResponse)!.bch!).toBe(0.1);

    const charlie = await RegTestSmartBchWallet.newRandom();
    const sendManyResult = await alice.send(
      [
        { address: bob.getDepositAddress(), value: 0.1, unit: "bch" },
        { address: charlie.getDepositAddress(), value: 0.1, unit: "bch" },
      ],
      {},
      { gasPrice: 10 ** 10 }
    );

    expect(sendManyResult[0].balance!.bch!).toBeGreaterThan(
      balance.bch! - 3 * (0.1 + feeDelta)
    );
    expect(sendManyResult[1].balance!.bch!).toBeGreaterThan(
      balance.bch! - 3 * (0.1 + feeDelta)
    );

    expect(((await bob.getBalance()) as BalanceResponse)!.bch!).toBe(0.2);
    expect(((await charlie.getBalance()) as BalanceResponse)!.bch!).toBe(0.1);

    await charlie.sendMax(
      alice.getDepositAddress(),
      {},
      { gasPrice: 10 ** 10 }
    );
    expect(
      ((await charlie.getBalance()) as BalanceResponse)!.sat!
    ).toBeLessThan(50000);
  });

  test("Test waiting and watching", async () => {
    // let all transactions in previous blocks be settled
    await delay(7000);

    const alice = await RegTestSmartBchWallet.fromId(
      process.env.SBCH_ALICE_ID!
    );

    const bob = await RegTestSmartBchWallet.newRandom();

    let waitTxResult = false;
    setTimeout(async () => {
      const result = await alice.waitForTransaction({
        getBalance: true,
        getTransactionInfo: true,
      });
      expect(result.balance!.sat!).toBeGreaterThan(0);
      expect(result.transactionInfo!.transactionHash.length).toBe(66);
      waitTxResult = true;
    }, 0);

    let waitBalanceResult = false;
    setTimeout(async () => {
      const result = (await alice.waitForBalance(
        0.001,
        "bch"
      )) as BalanceResponse;
      expect(result.sat!).toBeGreaterThan(0);
      waitBalanceResult = true;
    }, 0);

    let aliceWatchResult = false;
    const aliceWatchCancel = alice.watchAddressTransactions((tx) => {
      expect(tx.from!).toBe(alice.getDepositAddress());
      expect(tx.to!).toBe(bob.getDepositAddress());
      aliceWatchCancel();
      aliceWatchResult = true;
    });

    let bobWatchResult = false;
    const bobWatchCancel = bob.watchAddressTransactions((tx) => {
      expect(tx.from!).toBe(alice.getDepositAddress());
      expect(tx.to!).toBe(bob.getDepositAddress());
      bobWatchCancel();
      bobWatchResult = true;
    });

    let bobBalanceWatchResult = false;
    const bobBalanceWatchCancel = bob.watchBalance((balance) => {
      expect(balance.bch!).toBe(0.001);
      bobBalanceWatchCancel();
      bobBalanceWatchResult = true;
    });

    let blockWatchResult = false;
    const blockWatchCancel = bob.watchBlocks((block) => {
      expect(block.hash.length).toBe(66);
      blockWatchCancel();
      blockWatchResult = true;
    });

    let blockWaitResult = false;
    setTimeout(async () => {
      const blockNumber = await alice.provider!.getBlockNumber();
      const result = await alice.waitForBlock();
      expect(result.hash.length).toBe(66);
      expect(result.number).toBe(blockNumber + 1);
      blockWaitResult = true;
    }, 0);

    let blockNumberWaitResult = false;
    setTimeout(async () => {
      const blockNumber = await alice.provider!.getBlockNumber();
      const result = await alice.waitForBlock(blockNumber + 2);
      expect(result.hash.length).toBe(66);
      expect(result.number).toBe(blockNumber + 2);
      blockNumberWaitResult = true;
    }, 0);

    alice.send(
      { address: bob.getDepositAddress(), value: 0.001, unit: "bch" },
      {},
      { gasPrice: 10 ** 10 }
    );

    // lets wait for 2 more blocks to be mined
    await delay(15000);
    expect(waitTxResult).toBe(true);
    expect(waitBalanceResult).toBe(true);
    expect(aliceWatchResult).toBe(true);
    expect(bobWatchResult).toBe(true);
    expect(bobBalanceWatchResult).toBe(true);
    expect(blockWatchResult).toBe(true);
    expect(blockWaitResult).toBe(true);
    expect(blockNumberWaitResult).toBe(true);
  });

  test("Test faucet", async () => {
    const alice = await TestNetSmartBchWallet.newRandom(

    );

    console.log(await alice.getTestnetSatoshis());
  });
});

'use strict';

var buffer = require('buffer');

var Signature = require('../crypto/signature');
var Script = require('../script');
var Output = require('./output');
var BufferReader = require('../encoding/bufferreader');
var BufferWriter = require('../encoding/bufferwriter');
var BN = require('../crypto/bn');
var Hash = require('../crypto/hash');
var ECDSA = require('../crypto/ecdsa');
var $ = require('../util/preconditions');
var _ = require('lodash');

var SIGHASH_SINGLE_BUG = '0000000000000000000000000000000000000000000000000000000000000001';
var BITS_64_ON = 'ffffffffffffffff';

/**
 * Returns a buffer of length 32 bytes with the hash that needs to be signed
 * for OP_CHECKSIG.
 *
 * @name Signing.sighash
 * @param {Transaction} transaction the transaction to sign
 * @param {number} sighashType the type of the hash
 * @param {number} inputNumber the input index for the signature
 * @param {Script} subscript the script that will be signed
 */
var sighash = function sighash(transaction, sighashType, inputNumber, subscript) {
  var Transaction = require('./transaction');
  var Input = require('./input');

  var writer;

  writer = new BufferWriter();
  _.each(transaction.inputs, function(input) {
    writer.writeReverse(input.prevTxId);
    writer.writeUInt32LE(input.outputIndex);
  });
  var hashPrevouts = Hash.sha256sha256(writer.toBuffer());

  writer = new BufferWriter();
  _.each(transaction.inputs, function(input) {
    writer.writeUInt32LE(input.sequenceNumber);
  });
  var hashSequence = Hash.sha256sha256(writer.toBuffer());

  writer = new BufferWriter();
  _.each(transaction.outputs, function(output) {
    output.toBufferWriter(writer, false, false);
  });
  var hashOutputs = Hash.sha256sha256(writer.toBuffer());

  writer = new BufferWriter();

  var numV = transaction.version;
  writer.writeUInt32LE(numV)

  writer.write(hashPrevouts);
  writer.write(hashSequence);

  var ini = transaction.inputs[inputNumber];
  writer.writeReverse(ini.prevTxId);
  writer.writeUInt32LE(ini.outputIndex);

  subscript = new Script(subscript);
  subscript.removeCodeseparators();
  var scriptBuffer = subscript.toBuffer()
  writer.writeVarintNum(scriptBuffer.length);
  writer.write(scriptBuffer);

  // amount
  if (transaction.bnInputAmounts) {
    writer.writeUInt64LEBN(transaction.bnInputAmounts[inputNumber]);
  } else {
    writer.writeUInt64LEBN(ini.output._satoshisBN);
  }

  writer.writeUInt32LE(ini.sequenceNumber);
  // Outputs (none/one/all, depending on flags)
  writer.write(hashOutputs);
  // Locktime
  writer.writeUInt32LE(transaction.nLockTime);
  // Sighash type
  writer.writeInt32LE(sighashType)

  var ret = Hash.sha256sha256(writer.toBuffer());
  ret = new BufferReader(ret).readReverse();

  return ret;

  /*
  var i;
  // Copy transaction
  var txcopy = Transaction.shallowCopy(transaction);

  // Copy script
  subscript = new Script(subscript);
  subscript.removeCodeseparators();

  for (i = 0; i < txcopy.inputs.length; i++) {
    // Blank signatures for other inputs
    txcopy.inputs[i] = new Input(txcopy.inputs[i]).setScript(Script.empty());
  }

  txcopy.inputs[inputNumber] = new Input(txcopy.inputs[inputNumber]).setScript(subscript);

  if ((sighashType & 31) === Signature.SIGHASH_NONE ||
    (sighashType & 31) === Signature.SIGHASH_SINGLE) {

    // clear all sequenceNumbers
    for (i = 0; i < txcopy.inputs.length; i++) {
      if (i !== inputNumber) {
        txcopy.inputs[i].sequenceNumber = 0;
      }
    }
  }

  if ((sighashType & 31) === Signature.SIGHASH_NONE) {
    txcopy.outputs = [];

  } else if ((sighashType & 31) === Signature.SIGHASH_SINGLE) {
    // The SIGHASH_SINGLE bug.
    // https://bitcointalk.org/index.php?topic=260595.0
    if (inputNumber >= txcopy.outputs.length) {
      return new Buffer(SIGHASH_SINGLE_BUG, 'hex');
    }

    txcopy.outputs.length = inputNumber + 1;

    for (i = 0; i < inputNumber; i++) {
      txcopy.outputs[i] = new Output({
        satoshis: BN.fromBuffer(new buffer.Buffer(BITS_64_ON, 'hex')),
        script: Script.empty()
      });
    }
  }

  if (sighashType & Signature.SIGHASH_ANYONECANPAY) {
    txcopy.inputs = [txcopy.inputs[inputNumber]];
  }

  var buf = new BufferWriter()
    .write(txcopy.toBuffer(false))
    .writeInt32LE(sighashType)
    .toBuffer();
  var ret = Hash.sha256sha256(buf);
  ret = new BufferReader(ret).readReverse();

  return ret;
  */
};

/**
 * Create a signature
 *
 * @name Signing.sign
 * @param {Transaction} transaction
 * @param {PrivateKey} privateKey
 * @param {number} sighash
 * @param {number} inputIndex
 * @param {Script} subscript
 * @return {Signature}
 */
function sign(transaction, privateKey, sighashType, inputIndex, subscript) {
  var hashbuf = sighash(transaction, sighashType, inputIndex, subscript);
  var sig = ECDSA.sign(hashbuf, privateKey, 'little').set({
    nhashtype: sighashType
  });

  return sig;
}

/**
 * Verify a signature
 *
 * @name Signing.verify
 * @param {Transaction} transaction
 * @param {Signature} signature
 * @param {PublicKey} publicKey
 * @param {number} inputIndex
 * @param {Script} subscript
 * @return {boolean}
 */
function verify(transaction, signature, publicKey, inputIndex, subscript) {
  $.checkArgument(!_.isUndefined(transaction));
  $.checkArgument(!_.isUndefined(signature) && !_.isUndefined(signature.nhashtype));

  var hashbuf = sighash(transaction, signature.nhashtype, inputIndex, subscript);

  return ECDSA.verify(hashbuf, signature, publicKey, 'little');
}

/**
 * @namespace Signing
 */
module.exports = {
  sighash: sighash,
  sign: sign,
  verify: verify
};
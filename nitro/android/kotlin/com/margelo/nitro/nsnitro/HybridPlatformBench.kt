package com.margelo.nitro.nsnitro

import com.margelo.nitro.core.ArrayBuffer
import java.security.MessageDigest

class HybridPlatformBench : HybridPlatformBenchSpec() {
  companion object : HybridPlatformBenchSpec.Companion {
    override fun constructor(): HybridPlatformBench = HybridPlatformBench()

    override fun addStatic(a: Double, b: Double): Double = a + b
  }

  override fun add(a: Double, b: Double): Double = a + b

  override fun formatRecord(label: String, score: Double, index: Double): String =
    "[Kotlin#${index.toInt()}] $label => ${(score * 100.0).toInt()}"

  override fun sha256(data: ArrayBuffer): String {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(data.getBuffer(false))
    return hex(digest.digest())
  }

  override fun sha256String(input: String): String =
    hex(MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8)))
}

private val HEX_DIGITS = "0123456789abcdef".toCharArray()

private fun hex(bytes: ByteArray): String {
  val out = CharArray(bytes.size * 2)
  for (i in bytes.indices) {
    val v = bytes[i].toInt() and 0xff
    out[i * 2] = HEX_DIGITS[v ushr 4]
    out[i * 2 + 1] = HEX_DIGITS[v and 0x0f]
  }
  return String(out)
}

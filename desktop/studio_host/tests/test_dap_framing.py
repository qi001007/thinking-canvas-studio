from __future__ import annotations

import unittest

from studio_host.dap_framing import DapFrameDecoder, DapFrameError, encode_dap_frame


class DapFramingTests(unittest.TestCase):
    def test_round_trip_unicode_and_multibyte_fragmentation(self) -> None:
        message = {"seq": 1, "type": "output", "body": {"output": "变量 π 🙂"}}
        frame = encode_dap_frame(message)
        decoder = DapFrameDecoder()
        frames = []
        for byte in frame:
            frames.extend(decoder.feed(bytes([byte])))
        self.assertEqual(frames, [message])

    def test_accepts_coalesced_frames(self) -> None:
        first = {"seq": 1, "type": "event", "event": "stopped"}
        second = {"seq": 2, "type": "response", "success": True}
        decoder = DapFrameDecoder()
        self.assertEqual(decoder.feed(encode_dap_frame(first) + encode_dap_frame(second)), [first, second])

    def test_holds_partial_body_until_complete(self) -> None:
        frame = encode_dap_frame({"message": "ok"})
        decoder = DapFrameDecoder()
        self.assertEqual(decoder.feed(frame[:-1]), [])
        self.assertEqual(decoder.feed(frame[-1:]), [{"message": "ok"}])

    def test_rejects_malformed_header_and_length(self) -> None:
        samples = [
            b"Content-Length 3\r\n\r\n{}",
            b"Content-Length: 1\r\nContent-Length: 1\r\n\r\nx",
            b"Content-Length: -1\r\n\r\nx",
            b"Content-Length: nope\r\n\r\nx",
            b"Content-Length: 1\xff\r\n\r\nx",
        ]
        for sample in samples:
            with self.subTest(sample=sample), self.assertRaises(DapFrameError):
                DapFrameDecoder().feed(sample)

    def test_rejects_invalid_json_utf8_and_non_object(self) -> None:
        for body in (b"{", b"\xff", b"[]"):
            frame = b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
            with self.subTest(body=body), self.assertRaises(DapFrameError):
                DapFrameDecoder().feed(frame)

    def test_rejects_oversize_header_and_body(self) -> None:
        with self.assertRaisesRegex(DapFrameError, "header exceeds"):
            DapFrameDecoder(max_header_bytes=12).feed(b"X-Too-Long: 12345")
        with self.assertRaisesRegex(DapFrameError, "body exceeds"):
            DapFrameDecoder(max_body_bytes=4).feed(b"Content-Length: 5\r\n\r\n12345")

    def test_rejects_oversize_receive_chunk_before_buffering(self) -> None:
        decoder = DapFrameDecoder(max_chunk_bytes=8)
        with self.assertRaisesRegex(DapFrameError, "receive-chunk"):
            decoder.feed(b"x" * 9)
        with self.assertRaisesRegex(DapFrameError, "decoder is failed"):
            decoder.feed(b"")

    def test_accepts_coalesced_frames_across_bounded_chunks(self) -> None:
        messages = [{"seq": number, "type": "event"} for number in range(5)]
        data = b"".join(encode_dap_frame(message) for message in messages)
        decoder = DapFrameDecoder(max_chunk_bytes=16)
        frames = []
        for offset in range(0, len(data), decoder.max_chunk_bytes):
            frames.extend(decoder.feed(data[offset : offset + decoder.max_chunk_bytes]))
        self.assertEqual(frames, messages)

    def test_rejects_extremely_long_content_length_as_frame_error(self) -> None:
        header = b"Content-Length: " + b"9" * 5000 + b"\r\n\r\n"
        decoder = DapFrameDecoder(max_chunk_bytes=6000)
        with self.assertRaisesRegex(DapFrameError, "body exceeds"):
            decoder.feed(header)
        with self.assertRaisesRegex(DapFrameError, "decoder is failed"):
            decoder.feed(b"")

    def test_rejects_non_finite_numbers_and_duplicate_json_keys(self) -> None:
        bodies = (
            b'{"value":NaN}', b'{"value":Infinity}', b'{"value":-Infinity}',
            b'{"value":1e9999}', b'{"value":1,"value":2}',
        )
        for body in bodies:
            frame = b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
            with self.subTest(body=body), self.assertRaises(DapFrameError):
                DapFrameDecoder().feed(frame)

    def test_wraps_deep_json_recursion_as_frame_error(self) -> None:
        body = b"{" * 2000 + b"0" + b"}" * 2000
        frame = b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
        with self.assertRaises(DapFrameError):
            DapFrameDecoder(max_body_bytes=len(body) + 1).feed(frame)

    def test_decoder_is_poisoned_after_protocol_error(self) -> None:
        decoder = DapFrameDecoder()
        with self.assertRaises(DapFrameError):
            decoder.feed(b"bad\r\n\r\n")
        with self.assertRaisesRegex(DapFrameError, "decoder is failed"):
            decoder.feed(encode_dap_frame({"ok": True}))

    def test_encoder_rejects_non_json_and_oversize(self) -> None:
        with self.assertRaises(DapFrameError):
            encode_dap_frame({"bad": object()})
        with self.assertRaises(DapFrameError):
            encode_dap_frame({"value": "long"}, max_body_bytes=2)

    def test_frame_limits_require_positive_integer_boundaries(self) -> None:
        for value in (0, -1, True, 1.5):
            with self.subTest(value=value), self.assertRaises(ValueError):
                DapFrameDecoder(max_chunk_bytes=value)
        for value in (0, True, 1.5):
            with self.subTest(encoder_limit=value), self.assertRaises(ValueError):
                encode_dap_frame({"ok": True}, max_body_bytes=value)


if __name__ == "__main__":
    unittest.main()

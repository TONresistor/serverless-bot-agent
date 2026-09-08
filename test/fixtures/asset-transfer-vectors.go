// Regenerate in a standalone Go module requiring
// github.com/xssnick/tonutils-go v1.16.0, then run this file.
// Uses the independent tonutils-go typed TL-B serializers.
// Synthetic public addresses only. No network calls, keys or broadcasts.
package main

import (
  "encoding/hex"
  "encoding/json"
  "fmt"
  "math/big"
  "github.com/xssnick/tonutils-go/address"
  "github.com/xssnick/tonutils-go/tlb"
  "github.com/xssnick/tonutils-go/ton/jetton"
  "github.com/xssnick/tonutils-go/ton/nft"
  "github.com/xssnick/tonutils-go/tvm/cell"
)

func main() {
  owner := address.NewAddress(0, 0, make([]byte, 32))
  recipientBytes := make([]byte, 32)
  for i := range recipientBytes { recipientBytes[i] = 1 }
  recipient := address.NewAddress(0, 0, recipientBytes)
  amount, err := tlb.FromNano(big.NewInt(1500001), 0)
  if err != nil { panic(err) }
  j, err := tlb.ToCell(jetton.TransferPayload{QueryID: 0x0123456789abcdef, Amount: amount, Destination: recipient, ResponseDestination: owner, ForwardTONAmount: tlb.MustFromTON("0"), ForwardPayload: cell.BeginCell().EndCell()})
  if err != nil { panic(err) }
  n, err := tlb.ToCell(nft.TransferPayload{QueryID: 0x0123456789abcdef, NewOwner: recipient, ResponseDestination: owner, ForwardAmount: tlb.MustFromTON("0"), ForwardPayload: cell.BeginCell().EndCell()})
  if err != nil { panic(err) }
  out := map[string]any{"source": "tonutils-go v1.16.0 typed jetton.TransferPayload / nft.TransferPayload", "query_id": "81985529216486895", "amount_raw": "1500001", "owner": owner.String(), "recipient": recipient.String(), "jetton_body_hex": hex.EncodeToString(j.ToBOC()), "jetton_body_hash": hex.EncodeToString(j.Hash()), "nft_body_hex": hex.EncodeToString(n.ToBOC()), "nft_body_hash": hex.EncodeToString(n.Hash())}
  data, err := json.MarshalIndent(out, "", "  ")
  if err != nil { panic(err) }
  fmt.Println(string(data))
}

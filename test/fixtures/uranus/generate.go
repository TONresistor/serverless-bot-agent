//go:build ignore

// Independent vectors copied from MyDuckAI d680eba pkg/wallet/uranus.go.
// Run with the reference Go module available; output is the committed golden.json.
package main

import (
 "encoding/base64"
 "encoding/hex"
 "encoding/json"
 "fmt"
 "math/big"
 "strings"
 "github.com/xssnick/tonutils-go/address"
 "github.com/xssnick/tonutils-go/tvm/cell"
)

func main() {
 owner, err := address.ParseAddr("EQAmkd4Pd_xgUW4b9MLrygf0SOfR2EUVa_iCtVWGnYB2hItG")
 if err != nil { panic(err) }
 buy := cell.BeginCell().MustStoreUInt(0x94826557,32).MustStoreUInt(0,64).MustStoreBigCoins(big.NewInt(5000000000)).MustStoreBigCoins(big.NewInt(42)).MustStoreAddr(owner).MustStoreBoolBit(false).MustStoreBoolBit(false).EndCell()
 sell := cell.BeginCell().MustStoreUInt(0xb7459e2c,32).MustStoreUInt(0,64).MustStoreBigCoins(big.NewInt(1000000000)).MustStoreBigCoins(big.NewInt(7)).MustStoreAddr(owner).MustStoreBoolBit(false).MustStoreBoolBit(false).EndCell()
 deploy := func(uri string)*cell.Cell { return cell.BeginCell().MustStoreUInt(0x6ff416dc,32).MustStoreUInt(0,64).MustStoreUInt(7,4).MustStoreRef(cell.BeginCell().MustStoreStringSnake(uri).EndCell()).MustStoreBigCoins(big.NewInt(2000000000)).MustStoreBoolBit(false).MustStoreBoolBit(false).EndCell() }
 claim := cell.BeginCell().MustStoreUInt(0xad7269a8,32).MustStoreUInt(0,64).MustStoreAddr(owner).MustStoreAddr(owner).EndCell()
 out := map[string]any{}
 for name,c := range map[string]*cell.Cell{"buy":buy,"sell":sell,"deploy":deploy("https://meta.example/duck.json"),"deploy_long":deploy("https://meta.example/"+strings.Repeat("duck",80)+".json"),"claim":claim} { out[name] = map[string]string{"hash":hex.EncodeToString(c.Hash()),"boc":base64.StdEncoding.EncodeToString(c.ToBOC())} }
 body,err:=json.MarshalIndent(out,"","  "); if err != nil {panic(err)}; fmt.Println(string(body))
}

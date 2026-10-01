module github.com/terra-project/terra/module/leaf/io.terra.io-weave

go 1.23.0

replace github.com/terra-project/terra/products/common/packages/terra-module-sdk => ../../../../products/common/packages/terra-module-sdk

replace github.com/terra-project/terra/products/common/packages/terra-module-runtime => ../../../../products/common/packages/terra-module-runtime

replace github.com/terra-project/terra/products/common/packages/terra-protocol => ../../../../products/common/packages/terra-protocol

replace github.com/terra-project/terra/products/common/packages/terra-svi => ../../../../products/common/packages/terra-svi

replace github.com/terra-project/terra/products/common/packages/terra-io-weave => ../../../../products/common/packages/terra-io-weave

require (
	github.com/terra-project/terra/products/common/packages/terra-io-weave v0.0.0
	github.com/terra-project/terra/products/common/packages/terra-module-sdk v0.0.0
	github.com/terra-project/terra/products/common/packages/terra-protocol v0.0.0
	github.com/terra-project/terra/products/common/packages/terra-svi v0.0.0
	github.com/terra-project/terra/products/common/packages/terra-testwait v0.0.0
)

replace github.com/terra-project/terra/products/common/packages/terra-testwait => ../../../../products/common/packages/terra-testwait
